
import os
import sys
import redis
import json
import time
import re
import yaml # [NEW]
from markitdown import MarkItDown
from markitdown import MarkItDown
import chromadb
from neo4j import GraphDatabase
from google import genai
from google.genai import types
from dotenv import load_dotenv

load_dotenv()

from concurrent.futures import ThreadPoolExecutor, as_completed
import sys
import os

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from python_services.db import get_db, Document, Project, SessionLocal

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
KNOWLEDGE_DIR = 'knowledge'

# Load Taxonomy Seed
TAXONOMY_PATH = os.path.join(os.path.dirname(__file__), 'taxonomy_seed.yaml')
TAXONOMY_CONTENT = ""
if os.path.exists(TAXONOMY_PATH):
    with open(TAXONOMY_PATH, 'r') as f:
        TAXONOMY_CONTENT = f.read()
else:
    print("Warning: taxonomy_seed.yaml not found.")


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

try:
    chroma_client = chromadb.HttpClient(host=CHROMA_HOST, port=CHROMA_PORT)
    chroma_collection = chroma_client.get_or_create_collection(name="nexis_knowledge")
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

# Initialize MarkItDown
markitdown = MarkItDown()

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

def ingest_to_vector_db(filename, content):
    """
    Ingests text content into ChromaDB using semantic chunking.
    """
    # Re-fetch collection to handle potential restarts/stale connections
    try:
        global chroma_collection
        chroma_collection = chroma_client.get_or_create_collection(name="nexis_knowledge")
    except Exception as e:
        print(f"Error connecting to ChromaDB: {e}")
        return

    if not chroma_collection:
        return
    try:
        # Use semantic chunking
        chunks = semantic_chunking(content)
        
        ids = [f"{filename}_{i}" for i in range(len(chunks))]
        metadatas = [{"source": filename, "chunk_index": i} for i in range(len(chunks))]
        
        if chunks:
            chroma_collection.add(documents=chunks, metadatas=metadatas, ids=ids)
            print(f"Ingested {len(chunks)} semantic chunks into ChromaDB.")
    except Exception as e:
        print(f"Error ingesting to ChromaDB: {e}")

def extract_and_ingest_graph(filename, content):
    if not neo4j_driver or not client:
        return

    print("Extracting graph entities (Semantic Batched)...")

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
            if val == "qwen-plus":
                llm_provider = "qwen-plus"
        except:
            pass

    print(f"Extraction pipeline primed for {total_batches} batches via ThreadPool with engine {llm_provider}.")

    def process_batch(idx, batch_text):
        print(f"[{llm_provider}] Thread started for batch {idx+1}/{total_batches} ({len(batch_text)} chars)")
        prompt = f"""
        Analyze the following text from a technical specification document.
        
        ### Master Taxonomy (Reference this for categorization):
        {TAXONOMY_CONTENT}
        
        ### Tasks:
        1. **Classify**: Identify the **Module** AND **SubModule** this text belongs to.
           - Use the Taxonomy above based on the [Context] headers provided in the text.
           - **Primary Module**: (e.g., "出票业务")
           - **Sub-Module**: (e.g., "出票登记" or "提示承兑").
        2. **Extract**: Identify key entities and their relationships.
           - You are operating on a small, dense semantic window. Extract EVERY pertinent domain entity.
           - **CRITICAL DE-DUPLICATION RULE**: Do NOT extract any entity whose name is literally identical to the `primary_module` or `sub_module`. (e.g., if the sub-module is "出票登记", do not create an entity named "出票登记"). The system already models the module hierarchy; extracting it again as a standalone entity creates graph pollution.
        
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
          "primary_module": "Name from Taxonomy",
          "sub_module": "SubModule Name",
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
                if llm_provider == "qwen-plus" and openai_client:
                    completion = openai_client.chat.completions.create(
                        model="qwen-plus",
                        messages=[{"role": "user", "content": prompt}],
                        temperature=0.1
                    )
                    response_text = completion.choices[0].message.content
                else:
                    response = client.models.generate_content(
                        model=os.getenv('GEMINI_MODEL', 'gemini-3-flash-preview'),
                        contents=prompt,
                        config=types.GenerateContentConfig(
                            response_mime_type="application/json"
                        )
                    )
                    response_text = response.text
                break # Success
            except Exception as e:
                print(f"LLM API Error thread {idx+1} (Attempt {attempt+1}/{max_retries}): {e}")
                if attempt < max_retries - 1:
                    time.sleep(retry_delay * (attempt + 1))
                else:
                    print(f"Skipping batch {idx} after max retries.")
                    return None
        
        if not response_text:
            return None
            
        # Parse JSON
        data = None
        try:
            data = json.loads(response_text)
        except json.JSONDecodeError:
            match = re.search(r'\{.*\}', response_text, re.DOTALL)
            if match:
                data = json.loads(match.group(0))
            else:
                return None
        
        if isinstance(data, list):
            if len(data) > 0 and isinstance(data[0], dict):
                data = data[0]
            else:
                return None
        elif not isinstance(data, dict):
             return None

        primary_module = data.get("primary_module")
        if not primary_module:
            primary_module = "Uncategorized"
            
        sub_module = data.get("sub_module")
        if not sub_module:
            sub_module = "General"

        try:
            with neo4j_driver.session() as session:
                # 1. Create Document Anchor with Lifecycle Properties
                session.run(
                    """
                    MERGE (d:Document {name: $filename})
                    SET d.status = 'EFFECTIVE', d.version = 'latest', d.ingested_at = datetime()
                    """,
                    filename=filename
                )

                # 2. Create Module Hierarchy: (SubModule)-[:PART_OF]->(Module)
                session.run(
                    """
                    MERGE (m:Module {name: $module_name})
                    MERGE (s:SubModule {name: $sub_module_name})
                    MERGE (s)-[:PART_OF]->(m)
                    
                    WITH m, s
                    MATCH (d:Document {name: $filename})
                    MERGE (d)-[:CONTAINS]->(s)
                    """,
                    module_name=primary_module, 
                    sub_module_name=sub_module,
                    filename=filename
                )

                # 3. Create Nodes & Link primarily to SubModule (and implicitly Module via hierarchy)
                for node in data.get("nodes", []):
                    session.run(
                        """
                        MERGE (n:Entity {name: $name}) 
                        SET n.type = $type,
                            n.extracted_by = $llm_provider
                        WITH n
                        MATCH (d:Document {name: $filename})
                        MATCH (s:SubModule {name: $sub_module_name})
                        MATCH (m:Module {name: $module_name})
                        MERGE (n)-[:MENTIONED_IN]->(d)
                        MERGE (n)-[:BELONGS_TO]->(s)
                        """,
                        name=node["name"], type=node["type"], 
                        llm_provider=llm_provider,
                        filename=filename, 
                        sub_module_name=sub_module,
                        module_name=primary_module
                    )
                
                # 4. Create Edges
                for edge in data.get("edges", []):
                    session.run(
                        """
                        MATCH (a:Entity {name: $source}), (b:Entity {name: $target})
                        MERGE (a)-[r:RELATION]->(b)
                        ON CREATE SET r.types = [$relation]
                        ON MATCH SET r.types = CASE WHEN NOT $relation IN r.types THEN r.types + $relation ELSE r.types END
                        """,
                        source=edge["source"], target=edge["target"], relation=edge["relation"]
                    )
            
            print(f"Batch {idx+1}/{total_batches} completed: {len(data.get('nodes', []))} nodes.")
            return len(data.get("nodes", []))

        except Exception as e:
            print(f"Neo4j Error writing batch {idx}: {e}")
            return None

    # Step: Execute ThreadPool
    nodes_extracted = 0
    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = {executor.submit(process_batch, idx, text): idx for idx, text in enumerate(extraction_batches)}
        for future in as_completed(futures):
            res = future.result()
            if res:
                   nodes_extracted += res
                   
    print(f"--- Concurrent Extraction Complete --- Total raw nodes recorded: {nodes_extracted}")
    
    # Deferred Global Conflict Detection
    if nodes_extracted > 0:
        print("Initiating Deferred Global Conflict Detection Job...")
        # Start global conflict detection over ALL extracted chunks
        # Because the graph is fully assembled, neo4j will find all newly minted nodes for this document
        detector = ConflictDetector(neo4j_driver, client)
        detector.detect_and_record(
            filename=filename, 
            document_content=content 
        )
    print("Graph ingestion entirely finalized.")
        
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

def process_file(file_path, document_id=None):
    print(f"Processing. file: {file_path}, document_id: {document_id}")
    if not os.path.exists(file_path):
        return False
        
    db = SessionLocal()
    try:
        if document_id:
            print(f"Updating Postgres document {document_id} to PROCESSING...")
            doc = db.query(Document).filter(Document.id == document_id).first()
            if doc:
                doc.status = "PROCESSING"
                db.commit()
                print("Set status to PROCESSING.")
            else:
                print(f"Document {document_id} not found in DB!")

        # Use MarkItDown for conversion
        result = markitdown.convert(file_path)
        md_content = result.text_content
        
        filename = os.path.basename(file_path)
        name, _ = os.path.splitext(filename)
        output_path = os.path.join(KNOWLEDGE_DIR, f"{name}.md")
        
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(md_content)
            
        print(f"Converted to {output_path} using MarkItDown")

        ingest_to_vector_db(filename, md_content)
        extract_and_ingest_graph(filename, md_content)

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
                    
                    if file_path:
                        process_file(file_path, document_id)
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
