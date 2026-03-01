
import os
import sys
import redis
import json
import time
import re
import yaml # [NEW]
import docx2txt
import PyPDF2
import chromadb
from neo4j import GraphDatabase
from google import genai
from google.genai import types
from dotenv import load_dotenv

from chromadb.api.types import Documents, EmbeddingFunction, Embeddings

load_dotenv()

from concurrent.futures import ThreadPoolExecutor, as_completed
import sys
import os

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from python_services.db import get_db, Document, Domain, SessionLocal

# Configuration
REDIS_HOST = os.getenv('REDIS_HOST', 'localhost')
REDIS_PORT = int(os.getenv('REDIS_PORT', 6379))
print(f"Worker Configuration: Redis at {REDIS_HOST}:{REDIS_PORT}")
from conflict_detector import ConflictDetector
CHROMA_HOST = os.getenv('CHROMA_HOST', '127.0.0.1')
CHROMA_PORT = int(os.getenv('CHROMA_PORT', 8000))
NEO4J_URI = os.getenv('NEO4J_URI', 'bolt://localhost:7687')
NEO4J_USER = os.getenv('NEO4J_USER', 'neo4j')
NEO4J_PASSWORD = os.getenv('NEO4J_PASSWORD', 'nexis_password')
GEMINI_API_KEY = os.getenv('GEMINI_API_KEY')
QUEUE_NAME = 'nexis:ingest:queue'
KNOWLEDGE_DIR = os.getenv('KNOWLEDGE_DIR', '/app/processed_docs')

# Load Taxonomy dynamically per domain in extract_and_ingest_graph
# Initialize Clients
try:
    redis_client = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, decode_responses=True)
except Exception as e:
    redis_client = None

from openai import OpenAI
try:
    openai_client = OpenAI(
        api_key=os.getenv('DASHSCOPE_API_KEY', 'sk-dummy'),
        base_url="https://dashscope.aliyuncs.com/compatible-mode/v1"
    )
except Exception as e:
    openai_client = None
    print(f"Warning: OpenAI not connected: {e}")

class DashScopeEmbeddingFunction(EmbeddingFunction):
    def __init__(self, api_key, model_name="text-embedding-v4"):
        self.client = OpenAI(
            api_key=api_key,
            base_url="https://dashscope.aliyuncs.com/compatible-mode/v1"
        )
        self.model_name = model_name

    def __call__(self, input: Documents) -> Embeddings:
        if not input:
            return []
        
        # DashScope text-embedding v4 has a strict limit of 10 inputs per request
        batch_size = 10
        all_embeddings = []
        for i in range(0, len(input), batch_size):
            batch = input[i:i + batch_size]
            response = self.client.embeddings.create(
                model=self.model_name,
                input=batch
            )
            all_embeddings.extend([data.embedding for data in response.data])
            
        return all_embeddings

dashscope_ef = None
dashscope_key = os.getenv('DASHSCOPE_API_KEY')
if dashscope_key:
    dashscope_ef = DashScopeEmbeddingFunction(api_key=dashscope_key)
else:
    print("Warning: DASHSCOPE_API_KEY not set. Falling back to default embeddings.")

try:
    chroma_client = chromadb.HttpClient(host=CHROMA_HOST, port=CHROMA_PORT)
    chroma_collection = chroma_client.get_or_create_collection(
        name="nexis_knowledge",
        embedding_function=dashscope_ef
    )
except Exception as e:
    print(f"Warning: ChromaDB not connected: {e}")
    chroma_collection = None

try:
    neo4j_driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
except Exception as e:
    print(f"Warning: Neo4j not connected: {e}")
    neo4j_driver = None

if GEMINI_API_KEY:
    client = genai.Client(api_key=GEMINI_API_KEY)
else:
    client = None
    print("Warning: GEMINI_API_KEY not set")

# Custom extractor replacing markitdown for python 3.9 compatibility
def extract_text(file_path):
    ext = os.path.splitext(file_path)[1].lower()
    if ext == '.docx':
        return docx2txt.process(file_path)
    elif ext == '.pdf':
        text = ""
        with open(file_path, 'rb') as f:
            reader = PyPDF2.PdfReader(f)
            for page in reader.pages:
                text += page.extract_text() + "\n"
        return text
    else:
        with open(file_path, 'r', encoding='utf-8') as f:
            return f.read()

def semantic_chunking(markdown_text, max_chunk_size=1000):
    """
    Intelligent split focusing on hierarchy retention:
    1. Tracks current markdown tree (H1 > H2 > H3).
    2. Injects the contextual tree into the beginning of every chunk.
    3. If a section is too large, split by paragraphs.
    """
    chunks = []
    # Match headers keeping the text
    parts = re.split(r'(^#{1,6} .*$)', markdown_text, flags=re.MULTILINE)
    
    current_chunk = ""
    header_stack = []

    def get_context_path():
        if not header_stack: return ""
        # Clean paths: Remove '#' characters
        clean_paths = [h.lstrip('#').strip() for level, h in header_stack]
        return f"[Context: {' > '.join(clean_paths)}]\n\n"

    for part in parts:
        if not part.strip():
            continue
            
        header_match = re.match(r'^(#{1,6}) (.*)$', part.strip())
        if header_match:
            # Flush existing chunk
            if current_chunk:
                chunks.append(current_chunk.strip())
            
            level = len(header_match.group(1))
            header_text = part.strip()
            
            # Pop headers greater or equal to current level
            while header_stack and header_stack[-1][0] >= level:
                header_stack.pop()
                
            header_stack.append((level, header_text))
            
            # Start new context
            current_chunk = get_context_path() + header_text + "\n"
        else:
            # Content part
            if len(current_chunk) + len(part) <= max_chunk_size:
                current_chunk += part
            else:
                # Content too large, split by paragraphs
                paragraphs = part.split('\n\n')
                for para in paragraphs:
                    if not para.strip():
                        continue
                    if len(current_chunk) + len(para) <= max_chunk_size:
                        current_chunk += para + "\n\n"
                    else:
                        # Flush
                        if current_chunk.strip():
                            chunks.append(current_chunk.strip())
                        # Re-inject context for split chunks
                        current_chunk = get_context_path() + para + "\n\n"
    
    if current_chunk.strip():
        chunks.append(current_chunk.strip())
        
    return chunks

def ingest_to_vector_db(filename, content, domain_id=None, project_name=None):
    """
    Ingests text content into ChromaDB using semantic chunking.
    """
    try:
        global chroma_client
        collection_name = "nexis_knowledge"
        if domain_id:
            safe_id = domain_id.replace('-', '_')
            collection_name = f"nexis_{safe_id}"
            
        chroma_collection = chroma_client.get_or_create_collection(
            name=collection_name,
            embedding_function=dashscope_ef
        )
    except Exception as e:
        print(f"Error connecting to ChromaDB: {e}")
        return

    if not chroma_collection:
        return
    try:
        # Use semantic chunking
        chunks = semantic_chunking(content)
        
        ids = [f"{filename}_{i}" for i in range(len(chunks))]
        metadatas = []
        for i in range(len(chunks)):
            meta = {"source": filename, "chunk_index": i}
            if project_name:
                meta["projectName"] = project_name
            metadatas.append(meta)
        
        if chunks:
            chroma_collection.add(documents=chunks, metadatas=metadatas, ids=ids)
            print(f"Ingested {len(chunks)} semantic chunks into ChromaDB.")
    except Exception as e:
        print(f"Error ingesting to ChromaDB: {e}")

def extract_and_ingest_graph(filename, content, domain_id=None, project_name=None):
    if not neo4j_driver or not client:
        return

    print("Extracting graph entities (Semantic Batched)...")
    
    # 1. Fetch Dynamic Taxonomy
    db = SessionLocal()
    taxonomy_content = "No specific taxonomy defined for this domain."
    domain_name = "Default Domain"
    taxonomy_paths = {}
    if domain_id:
        from python_services.db import TaxonomyNode, Domain
        domain = db.query(Domain).filter(Domain.id == domain_id).first()
        if domain:
            domain_name = domain.name
            
        nodes = db.query(TaxonomyNode).filter(TaxonomyNode.domainId == domain_id).all()
        
        def build_path(node_id, current_nodes):
            node = next((n for n in current_nodes if n.id == node_id), None)
            if not node: return ""
            if not node.parentId: return node.name
            parent_path = build_path(node.parentId, current_nodes)
            return f"{parent_path} > {node.name}" if parent_path else node.name
            
        if nodes:
            paths = []
            for n in nodes:
                path = build_path(n.id, nodes)
                taxonomy_paths[path] = n.id
                paths.append(path)
                
            taxonomy_content = "Available Categories:\n" + "\n".join([f"- {p}" for p in paths])
            
            with neo4j_driver.session() as session:
                session.run("MERGE (dom:Domain {id: $domain_id}) ON CREATE SET dom.name = $domain_name", 
                            domain_id=domain_id, domain_name=domain_name)
                for n in nodes:
                    session.run("MERGE (nx:TaxonomyNode {id: $nid}) SET nx.name = $name WITH nx MATCH (dom:Domain {id: $domain_id}) MERGE (nx)-[:IN_DOMAIN]->(dom)",
                                nid=n.id, name=n.name, domain_id=domain_id)
                for n in nodes:
                    if n.parentId:
                        session.run("MATCH (child:TaxonomyNode {id: $child_id}) MATCH (parent:TaxonomyNode {id: $parent_id}) MERGE (child)-[:PART_OF]->(parent)",
                                    child_id=n.id, parent_id=n.parentId)
    db.close()
    
    if not taxonomy_content.strip() or taxonomy_content == "Available Categories:\n":
        taxonomy_content = "No specific taxonomy defined for this domain. Please infer categories."

    # Use semantic chunking for context-aware extraction windows
    semantic_chunks = semantic_chunking(content, max_chunk_size=1000)
    
    # Group chunks into larger extraction windows of roughly 4000 characters
    extraction_batches = []
    current_batch = ""
    target_extraction_size = 4000
    
    for chunk in semantic_chunks:
        if len(current_batch) + len(chunk) > target_extraction_size and current_batch:
            extraction_batches.append(current_batch)
            current_batch = chunk + "\n\n"
        else:
            current_batch += chunk + "\n\n"
            
    if current_batch.strip():
        extraction_batches.append(current_batch)

    total_batches = len(extraction_batches)
    
    # Determine provider dynamically
    llm_provider = os.getenv('GEMINI_MODEL', 'gemini-3-flash-preview')
    if redis_client:
        try:
            val = redis_client.get("nexis:settings:llm_provider")
            if val:
                llm_provider = val
        except:
            pass

    print(f"Extraction pipeline primed for {total_batches} batches via ThreadPool with engine {llm_provider}.")

    def process_batch(idx, batch_text):
        print(f"[{llm_provider}] Thread started for batch {idx+1}/{total_batches} ({len(batch_text)} chars)")
        prompt = f"""
        Analyze the following text from a technical specification document.
        
        ### Master Taxonomy (Reference this for categorization):
        {taxonomy_content}
        
        ### Tasks:
        1. **Classify**: Identify the most granular, specific **Category Path** this text belongs to.
           - Pick exactly ONE full path from the Available Categories above (e.g. "A > B > C").
        2. **Extract**: Identify key entities and their relationships.
           - You are operating on a small, dense semantic window. Extract EVERY pertinent domain entity.
           - **CRITICAL DE-DUPLICATION RULE**: Do NOT extract any entity whose name is literally identical to the category. The system already models the hierarchy; extracting it again as a standalone entity creates graph pollution.
        
        Target Entity Types:
        - **Person/Role**: (e.g., "出质人", "承兑方", "复核员")
        - **System/Component**: (e.g., "票交所", "前置机", "黑名单系统")
        - **BusinessState**: (e.g., "已出票", "待签收", "CS01")
        - **DataEntity/Protocol**: (e.g., "CIM.001.002", "大额支付行号", "提示付款金额")
        - **Action/Operation**: (e.g., "保证撤销", "质押解除申请", "自动应答")
        - **BusinessConcept**: (e.g., "背书转让", "备用清算路径")

        Return TRUE logical combinations.
        
        Return JSON format:
        {{
          "category_path": "One full exact path from the taxonomy list above, or 'Uncategorized'",
          "nodes": [{{"name": "Entity Name", "type": "Entity Type"}}],
          "edges": [{{"source": "Entity Name", "target": "Entity Name", "relation": "RELATIONSHIP_TYPE"}}],
          "valid_json": true
        }}
        
        Text Block:
        {batch_text}
        """

        max_retries = 3
        retry_delay = 2
        
        response_text = None
        for attempt in range(max_retries):
            try:
                import requests
                AGENT_API_URL = os.getenv('AGENT_API_URL', 'http://localhost:8002')
                response = requests.post(f"{AGENT_API_URL}/ingest-chunk", json={
                    "text": batch_text,
                    "domainId": domain_id,
                    "source": filename,
                    "projectName": project_name,
                    "provider": llm_provider
                }, timeout=120)
                
                if response.status_code == 200:
                    data = response.json()
                    print(f"Agent finished batch {idx+1}. Cycles: {data.get('cycles')}")
                    # Node.js Agent's write_subgraph tool already handled the Neo4j MERGEs!
                    return 1 # Just returning a success count
                else:
                    print(f"Agent API Error: {response.text}")
                    
            except Exception as e:
                print(f"Agent API Failure thread {idx+1} (Attempt {attempt+1}/{max_retries}): {e}")
                if attempt < max_retries - 1:
                    time.sleep(retry_delay * (attempt + 1))
                else:
                    print(f"Skipping batch {idx} after max retries.")
                    return None
                    
    # Step: Execute ThreadPool
    nodes_extracted = 0
    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = {executor.submit(process_batch, idx, text): idx for idx, text in enumerate(extraction_batches)}
        for future in as_completed(futures):
            res = future.result()
            if res:
                   nodes_extracted += res
                   
    print(f"--- Concurrent Agentic Ingestion Complete --- Batches processed: {nodes_extracted}")
    
    # Deferred Global Conflict Detection
    if nodes_extracted > 0:
        print("Initiating Deferred Global Conflict Detection Job...")
        # Step: Taxanomy Consolidation (Map-Reduce)
        consolidate_taxonomy_suggestions(domain_id, client)
        
        # Start global conflict detection over ALL extracted chunks
        # Because the graph is fully assembled, neo4j will find all newly minted nodes for this document
        detector = ConflictDetector(neo4j_driver, client)
        detector.detect_and_record(
            filename=filename, 
            document_content=content 
        )
    print("Graph ingestion entirely finalized.")
        
def consolidate_taxonomy_suggestions(domain_id, llm_client):
    try:
        from python_services.db import TaxonomySuggestion
        db = SessionLocal()
        # 1. Fetch all PENDING suggestions
        suggestions = db.query(TaxonomySuggestion).filter(
            TaxonomySuggestion.domainId == domain_id, 
            TaxonomySuggestion.status == 'PENDING'
        ).all()
        
        if len(suggestions) <= 1:
            return
            
        print(f"[TaxonomyConsolidation] Found {len(suggestions)} pending suggestions. Analyzing for merges...")
        suggestions_data = [{"id": s.id, "path": s.proposedPath, "reasoning": s.reasoning} for s in suggestions]
        
        # 2. Ask LLM to consolidate
        prompt = f"""
        You are an expert Ontology/Taxonomy architect. 
        Below is a JSON list of taxonomy structure suggestions generated by independent agents parsing different sections of a document.
        Because they lacked global context, many of these suggestions are semantically identical or very similar (e.g. "Payment Module" vs "Electronic Payments").
        
        Your task is to DEDUPLICATE and CONSOLIDATE these suggestions.
        Find groups of suggestions that represent the exact same logical concept. For each group, pick ONE primary ID to keep, and list the IDs of the others to merge into it. Provide a final `optimized_path` that best represents the group.
        
        Suggestions:
        {json.dumps(suggestions_data, ensure_ascii=False)}
        
        Output valid JSON only. Format:
        [
          {{
            "primary_id": "the-uuid-to-keep",
            "merged_ids": ["uuid-to-discard-1", "uuid-to-discard-2"],
            "optimized_path": "The Best Consolidated Name"
          }}
        ]
        If a suggestion is entirely unique and shouldn't merge, ignore it. Only output arrays for items that CAN be merged.
        """
        
        response = llm_client.models.generate_content(
            model='gemini-2.5-pro',
            contents=prompt,
        )
        # Extract JSON
        content_text = response.text
        json_match = re.search(r'```json\n(.*?)\n```', content_text, re.DOTALL)
        if json_match:
            content_text = json_match.group(1)
            
        merges = json.loads(content_text)
        
        if not merges:
           print("[TaxonomyConsolidation] LLM found no merges necessary.")
           return
           
        merged_count = 0
        with neo4j_driver.session() as session:
            for merge in merges:
                primary_id = merge.get("primary_id")
                merged_ids = merge.get("merged_ids", [])
                optimized_path = merge.get("optimized_path")
                
                if not primary_id or not merged_ids:
                    continue
                    
                # 3. Apply Neo4j Merges (Move BELONGS_TO edges)
                session.run(
                    """
                    MATCH (primary:TaxonomyNode {id: $primary_id})
                    MATCH (discarded:TaxonomyNode) WHERE discarded.id IN $merged_ids
                    SET primary.name = $optimized_path
                    WITH primary, discarded
                    MATCH (e:Entity)-[r:BELONGS_TO]->(discarded)
                    MERGE (e)-[:BELONGS_TO]->(primary)
                    DELETE r
                    DETACH DELETE discarded
                    """,
                    primary_id=primary_id,
                    merged_ids=merged_ids,
                    optimized_path=optimized_path
                )
                
                # 4. Update Postgres Status
                primary_record = db.query(TaxonomySuggestion).filter(TaxonomySuggestion.id == primary_id).first()
                if primary_record:
                    primary_record.proposedPath = optimized_path
                    
                db.query(TaxonomySuggestion).filter(TaxonomySuggestion.id.in_(merged_ids)).update(
                    {"status": "MERGED"}, synchronize_session=False
                )
                merged_count += len(merged_ids)
                
        db.commit()
        print(f"[TaxonomyConsolidation] Successfully merged {merged_count} duplicate suggestions into optimized nodes.")
        
    except Exception as e:
        print(f"[TaxonomyConsolidation] Failed during consolidation: {e}")

        
def check_document_conflicts(filename):
    if not neo4j_driver:
        return False
    try:
        with neo4j_driver.session() as session:
            result = session.run(
                """
                MATCH (new)-[:MENTIONED_IN]->(d:Document {name: $filename})
                MATCH (new)-[r:CONTRADICTS]->(old:Entity)
                RETURN count(r) as conflict_count
                """,
                filename=filename
            )
            count = result.single()["conflict_count"]
            return count > 0
    except Exception as e:
        print(f"Error checking global conflicts for {filename}: {e}")
        return False

def process_file(file_path, document_id=None, project_name=None):
    print(f"Processing. file: {file_path}, document_id: {document_id}")
    if not os.path.exists(file_path):
        return False
        
    db = SessionLocal()
    domain_id = None
    try:
        if document_id:
            print(f"Updating Postgres document {document_id} to PROCESSING...")
            doc = db.query(Document).filter(Document.id == document_id).first()
            if doc:
                domain_id = doc.domainId
                print(f"[{document_id}] Fetched bound DomainID: {domain_id}")
                doc.status = "PROCESSING"
                db.commit()
            else:
                print(f"Document {document_id} not found in DB!")

        if not domain_id:
             print("WARNING: No domain_id found for this document. Using fallback.")

        try:
            print(f"[{document_id}] Converting document to markdown format using local extractors...")
            raw_text = extract_text(file_path)
            md_content = raw_text # In a real scenario we could ask LLM to format this, but raw text works for RAG
        except Exception as e:
            raise Exception(f"Failed to convert document: {e}")
        
        filename = os.path.basename(file_path)
        name, _ = os.path.splitext(filename)
        output_path = os.path.join(KNOWLEDGE_DIR, f"{name}.md")
        
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(md_content)
            
        print(f"Converted to {output_path} using local extractors")

        ingest_to_vector_db(filename, md_content, domain_id, project_name)
        extract_and_ingest_graph(filename, md_content, domain_id, project_name)

        if document_id:
            doc = db.query(Document).filter(Document.id == document_id).first()
            if doc:
                has_conflicts = check_document_conflicts(filename)
                if has_conflicts:
                    doc.status = "NEEDS_REVIEW"
                    print("Set status to NEEDS_REVIEW due to conflicts.")
                else:
                    doc.status = "EFFECTIVE"
                    print("Set status to EFFECTIVE.")
                db.commit()
                
        return True
    except Exception as e:
        print(f"Error processing file {file_path}: {e}")
        db.rollback()
        if document_id:
            doc = db.query(Document).filter(Document.id == document_id).first()
            if doc:
                doc.status = "ERROR"
                doc.error_message = str(e)
                db.commit()
        return False
    finally:
        db.close()

def main():
    print(f"Starting Nexis Worker... Connecting to Redis at {REDIS_HOST}:{REDIS_PORT}")
    try:
        r = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, decode_responses=True)
        # Check connection
        r.ping()
        print("Connected to Redis.")
    except redis.ConnectionError as e:
        print(f"Error connecting to Redis: {e}")
        sys.exit(1)

    print(f"Waiting for jobs in {QUEUE_NAME}...")
    
    while True:
        try:
            # Blocking pop
            # Returns tuple (queue_name, value)
            task = r.blpop(QUEUE_NAME, timeout=10)
            
            if task:
                queue, job_json = task
                try:
                    job = json.loads(job_json)
                    file_path = job.get('filePath')
                    document_id = job.get('documentId')
                    project_name = job.get('projectName')
                    
                    if file_path:
                        process_file(file_path, document_id, project_name)
                    else:
                        print("Invalid job format: missing filePath")
                except json.JSONDecodeError:
                    print(f"Invalid JSON: {job_json}")
        except redis.RedisError as e:
            print(f"Redis error: {e}")
            time.sleep(5) # Wait before reconnecting
        except KeyboardInterrupt:
            print("Worker stopping...")
            break

if __name__ == "__main__":
    # Ensure knowledge dir exists
    if not os.path.exists(KNOWLEDGE_DIR):
        os.makedirs(KNOWLEDGE_DIR)
    main()
