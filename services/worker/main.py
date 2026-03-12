
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
AGENT_API_URL = os.getenv('AGENT_API_URL', 'http://localhost:8002')

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
            base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
            timeout=30.0
        )
        self.model_name = model_name

    def __call__(self, input: Documents) -> Embeddings:
        if not input:
            return []
        
        # DashScope text-embedding v4 has a strict limit of 10 inputs per request
        batch_size = 10
        all_embeddings = []
        print(f"[DIAGNOSTIC] Embedding {len(input)} chunks via DashScope...")
        for i in range(0, len(input), batch_size):
            batch = input[i:i + batch_size]
            print(f"[DIAGNOSTIC] Embedding batch {i//batch_size + 1}/{(len(input)-1)//batch_size + 1}...")
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

# markitdown is installed and works on Python 3.11 — converts docx/pdf to proper Markdown
# preserving heading styles (H1/H2/H3) as # markers so semantic_chunking works correctly.
def extract_text(file_path):
    try:
        from markitdown import MarkItDown
        md = MarkItDown()
        result = md.convert(file_path)
        return result.text_content
    except Exception as e:
        print(f"[extract_text] markitdown failed ({e}), falling back to raw extractor")
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
    Intelligent split with automatic strategy selection:
    - If the document has Markdown headers (≥5), use header-aware chunking
      (preserves H1>H2>H3 hierarchy, injects context path into every chunk).
    - If the document has few/no headers (visual-only formatting like bold+fontsize),
      fall back to paragraph-based chunking to avoid fixed-size character cutting.
    """
    # Auto-detect document structure
    header_count = len(re.findall(r'^#{1,6} ', markdown_text, flags=re.MULTILINE))

    if header_count < 5:
        # FALLBACK: paragraph-based chunking for documents without Word heading styles
        print(f"[semantic_chunking] Only {header_count} Markdown headers detected — using paragraph fallback strategy")
        return _paragraph_chunking(markdown_text, max_chunk_size)

    # STANDARD: header-aware chunking for properly structured documents
    chunks = []
    parts = re.split(r'(^#{1,6} .*$)', markdown_text, flags=re.MULTILINE)

    current_chunk = ""
    header_stack = []

    def get_context_path():
        if not header_stack: return ""
        clean_paths = [h.lstrip('#').strip() for level, h in header_stack]
        return f"[Context: {' > '.join(clean_paths)}]\n\n"

    for part in parts:
        if not part.strip():
            continue

        header_match = re.match(r'^(#{1,6}) (.*)$', part.strip())
        if header_match:
            if current_chunk:
                chunks.append(current_chunk.strip())

            level = len(header_match.group(1))
            header_text = part.strip()

            while header_stack and header_stack[-1][0] >= level:
                header_stack.pop()

            header_stack.append((level, header_text))
            current_chunk = get_context_path() + header_text + "\n"
        else:
            if len(current_chunk) + len(part) <= max_chunk_size:
                current_chunk += part
            else:
                paragraphs = part.split('\n\n')
                for para in paragraphs:
                    if not para.strip():
                        continue
                    if len(current_chunk) + len(para) <= max_chunk_size:
                        current_chunk += para + "\n\n"
                    else:
                        if current_chunk.strip():
                            chunks.append(current_chunk.strip())
                        current_chunk = get_context_path() + para + "\n\n"

    if current_chunk.strip():
        chunks.append(current_chunk.strip())

    return chunks


def _paragraph_chunking(text, max_chunk_size=700):
    """
    Fallback chunker for documents without Markdown headers.
    Splits on paragraph boundaries (\n\n or \n followed by numbering/bullet),
    then merges short paragraphs together up to max_chunk_size.
    """
    # Split on double newlines or lines starting with Chinese numbering / bullets
    raw_paras = re.split(r'\n{2,}|(?=\n[一二三四五六七八九十\d]+[、。\.）)]\s)', text)

    chunks = []
    current = ""

    for para in raw_paras:
        para = para.strip()
        if not para:
            continue
        # Skip pure table-of-content lines (number + dots + page number)
        if re.match(r'^.{1,40}\.{3,}\s*\d+$', para):
            continue
        # Skip very short noise lines (single field labels without content)
        if len(para) < 10:
            continue

        if len(current) + len(para) + 2 <= max_chunk_size:
            current = (current + "\n\n" + para).strip()
        else:
            if current:
                chunks.append(current)
            # If a single paragraph is larger than max, split by sentences
            if len(para) > max_chunk_size:
                sentences = re.split(r'(?<=[。！？；])', para)
                sub = ""
                for sent in sentences:
                    if len(sub) + len(sent) <= max_chunk_size:
                        sub += sent
                    else:
                        if sub:
                            chunks.append(sub.strip())
                        sub = sent
                if sub:
                    chunks.append(sub.strip())
                current = ""
            else:
                current = para

    if current:
        chunks.append(current)

    return chunks


def clean_document_noise(text: str) -> str:
    """
    Remove common noise from Chinese business requirement docs before vector embedding.
    Strips out version control tables, metadata headers, and Table of Contents.
    """
    lines = text.split('\n')
    cleaned_lines = []
    skip_mode = None
    
    for line in lines:
        stripped = line.strip()
        
        if skip_mode is None:
            if re.match(r'^(修订记录|版本记录|版本控制|文档说明|变更历史)$', stripped) or \
               ('文档及版本' in stripped) or ('文档控制' in stripped):
                skip_mode = 'version_table'
                continue
            elif re.match(r'^目\s*录$', stripped) or re.match(r'^Table of Contents$', stripped, re.IGNORECASE):
                skip_mode = 'toc'
                continue
                
        if skip_mode == 'version_table':
            # Exit when reaching TOC or first real section
            if re.match(r'^目\s*录$', stripped) or re.match(r'^(1\.|第[一二三]章|1\s|一、)', stripped):
                skip_mode = None
                # If it's TOC, enter TOC mode instead
                if re.match(r'^目\s*录$', stripped):
                    skip_mode = 'toc'
                    continue
            else:
                continue
                
        if skip_mode == 'toc':
            # Exit TOC when reaching first real section without trailing page numbers
            if re.match(r'^(1\.|第[一二三]章|1\s|一、)', stripped) and not re.search(r'\d+$', stripped):
                skip_mode = None
            else:
                continue
                
        if skip_mode is None:
            cleaned_lines.append(line)
            
    return '\n'.join(cleaned_lines)

def ingest_to_vector_db(filename, content, domain_id=None, project_name=None, project_id=None, status="EFFECTIVE"):
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
        print(f"[DIAGNOSTIC] Initialized Chroma Collection: {collection_name}, Initial Count: {chroma_collection.count()}")
    except Exception as e:
        print(f"Error connecting to ChromaDB: {e}")
        return

    if not chroma_collection:
        return
    try:
        # Pre-process content to remove noise (TOC, version history)
        cleaned_content = clean_document_noise(content)
        
        # Use semantic chunking with finer granularity (1000 -> 700)
        chunks = semantic_chunking(cleaned_content, max_chunk_size=700)
        
        ids = [f"{filename}_{i}" for i in range(len(chunks))]
        metadatas = []
        for i in range(len(chunks)):
            meta = {"source": filename, "chunk_index": i, "status": status}
            if project_name:
                meta["projectName"] = project_name
            if project_id:
                meta["projectId"] = project_id
            metadatas.append(meta)
        
        if chunks:
            print(f"[DIAGNOSTIC] Prepared {len(chunks)} chunks for {filename}. First chunk peek: {chunks[0][:50]}...")
            chroma_collection.add(documents=chunks, metadatas=metadatas, ids=ids)
            print(f"[DIAGNOSTIC] Vector Ingestion successful. New Count: {chroma_collection.count()}")
    except Exception as e:
        print(f"Error ingesting to ChromaDB: {e}")

def extract_and_ingest_graph(filename, content, domain_id=None, project_name=None, status="EFFECTIVE"):
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
    # Reduced from 1000 to 700 for finer Chinese document granularity
    semantic_chunks = semantic_chunking(content, max_chunk_size=700)
    
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
    llm_provider = os.getenv('GEMINI_MODEL', 'qwen-plus')
    if redis_client:
        try:
            val = redis_client.get("nexis:settings:llm_provider")
            if val:
                llm_provider = val
        except:
            pass

    print(f"Extraction pipeline primed for {total_batches} batches via ThreadPool with engine {llm_provider}.")

    # =====================================================================
    # PHASE 1: Full-Document Module Inference
    # Send the entire document to LLM to infer a unified module taxonomy.
    # This eliminates cross-chunk module fragmentation.
    # =====================================================================
    doc_inferred_taxonomy = taxonomy_content  # fallback: use existing taxonomy

    try:
        import requests as _requests
        print(f"[Phase 1] Sending full document ({len(content)} chars) to LLM for module inference...")
        phase1_prompt = f"""You are a business analyst reading a complete requirements document.
Your task: analyze the FULL document and output a unified, hierarchical module taxonomy for this system.

Rules:
1. Output 5-15 top-level or two-level module paths that cover ALL major functional areas of the document.
2. Use concise, business-meaningful Chinese names (e.g., "产品管理", "进件管理 > 进件流程").
3. Do NOT use document names, version numbers, project names, or author names as module names.
4. Each path must represent a real business function described in this document.
5. Output ONLY a JSON array of strings. No explanation, no markdown.

Example output:
["产品管理", "产品管理 > 产品上下架", "进件管理", "进件管理 > 进件流程", "渠道管理", "预授信管理"]

Full Document Content:
{content[:80000]}
"""
        AGENT_API_URL = os.getenv('AGENT_API_URL', 'http://localhost:8002')
        r = _requests.post(f"{AGENT_API_URL}/llm-complete", json={
            "prompt": phase1_prompt,
            "provider": llm_provider,
            "max_tokens": 1024,
        }, timeout=120)

        if r.status_code == 200:
            raw = r.json().get("text", "")
            # Extract JSON array from response
            import re as _re
            match = _re.search(r'\[.*?\]', raw, _re.DOTALL)
            if match:
                inferred_paths = json.loads(match.group(0))
                print(f"[Phase 1] LLM inferred {len(inferred_paths)} modules: {inferred_paths[:5]}...")
                # Merge inferred paths with any existing taxonomy
                combined_paths = list(taxonomy_paths.keys()) + [p for p in inferred_paths if p not in taxonomy_paths]
                doc_inferred_taxonomy = "Available Categories (Inferred from full document):\n" + \
                    "\n".join([f"- {p}" for p in combined_paths])
                print(f"[Phase 1] Final taxonomy has {len(combined_paths)} categories.")
            else:
                print(f"[Phase 1] Could not parse JSON from LLM response, using existing taxonomy. Raw: {raw[:200]}")
        else:
            print(f"[Phase 1] LLM complete endpoint returned {r.status_code}, using existing taxonomy.")
    except Exception as e:
        print(f"[Phase 1] Module inference failed ({e}), proceeding with existing taxonomy.")

    # Use the phase 1 result as the effective taxonomy for all chunks
    effective_taxonomy = doc_inferred_taxonomy


    def process_batch(idx, batch_text):
        print(f"[{llm_provider}] Thread started for batch {idx+1}/{total_batches} ({len(batch_text)} chars)")
        prompt = f"""You are a Knowledge Graph extraction expert analyzing a Chinese business requirements document.

### Master Taxonomy (Reference for categorization):
{effective_taxonomy}

### STEP 1 — NOISE FILTER (DO NOT extract these as entities):
- Document metadata: author names, review dates, version numbers, department approval chains from cover pages
- Table of contents entries and section numbers
- Words that are identical to category names already in the taxonomy above

### STEP 2 — ENTITY EXTRACTION (9 strict types, use ONLY these):
1. Role         — business roles/actors: 出质人, 营销人员, 复核员, 链信企业客户
2. System       — IT systems, apps, backends: 云贷系统, 云税系统, 链信APP, 云租后台
3. UIPage       — named UI screens/pages: 进件页, 产品详情页, 预授信管理列表
4. BusinessRule — conditions, constraints, validation rules (see STEP 3 patterns)
5. BusinessState— workflow states: 生效中, 已失效, 待审核, 上架中
6. DataEntity   — data fields/objects: 申请编号, 渠道ID, 授权书, 企业信息
7. API          — interface names: 归集申请接收接口, 授权回调接口
8. BusinessConcept — domain abstractions: 预授信, 返佣分润, 背书转让
9. Action       — operations/processes: 进件申请, 归集授权, 产品排序

DO NOT invent types outside these 9. If unsure, use BusinessConcept.

### STEP 3 — MANDATORY BusinessRule Detection:
Scan for these patterns — any match MUST produce a BusinessRule entity:
- Conditional: "当...时", "若...则", "满足...才能", "如果...否则"
- Numeric constraints: amount limits, quantity limits, time limits
- State transitions: "从A状态变为B状态的条件"
- Field validation: "必填", "非必填", "格式要求", "不能超过"

### STEP 4 — RELATIONSHIPS (use ONLY these):
BELONGS_TO | TRIGGERS | REQUIRES | VALIDATES | CALLS_API | HAS_STATE | OPERATED_BY | CONFIGURED_BY

### OUTPUT — JSON only, no markdown:
{{
  "category_path": "Full path from taxonomy above, or 'Uncategorized'",
  "nodes": [{{"name": "Entity Name", "type": "one of the 9 types above"}}],
  "edges": [{{"source": "Entity Name", "target": "Entity Name", "relation": "RELATION_TYPE"}}],
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
                    "status": status,
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
        if status != "SANDBOX":
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
        else:
            print(f"[{status}] document detected. Skipping permanent Taxonomy & Conflict recording.")
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
        prompt = """
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
        # Determine provider
        provider = "qwen-plus"
        if redis_client:
            stored_provider = redis_client.get("nexis:settings:llm_provider")
            if stored_provider:
                provider = stored_provider

        print(f"[TaxonomyConsolidation] Using LLM Provider: {provider}")

        if provider.startswith("qwen") and openai_client:
            response = openai_client.chat.completions.create(
                model=provider if provider != "qwen" else "qwen-plus",
                messages=[
                    {"role": "user", "content": prompt}
                ],
                response_format={"type": "json_object"}
            )
            content_text = response.choices[0].message.content
        elif llm_client:
            response = llm_client.models.generate_content(
                model='gemini-1.5-pro',
                contents=prompt,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json"
                )
            )
            content_text = response.text
        else:
            print("[TaxonomyConsolidation] No LLM client available.")
            return

        # Extract JSON if not in JSON mode
        if not content_text.strip().startswith("[") and not content_text.strip().startswith("{"):
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

def process_file(file_path, document_id=None, project_name=None, project_id=None, status="EFFECTIVE"):
    print(f"Processing. file: {file_path}, document_id: {document_id}, status: {status}")
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
             # Fallback to the first domain in the DB if none specified
             first_domain = db.query(Domain).first()
             if first_domain:
                 domain_id = first_domain.id
                 print(f"[{document_id}] Fallback domain_id set to: {domain_id}")
             else:
                 domain_id = "default"

        try:
            print(f"[{document_id}] Converting document to markdown format using local extractors...")
            raw_text = extract_text(file_path)
            md_content = raw_text 
        except Exception as e:
            raise Exception(f"Failed to convert document: {e}")
        
        filename = os.path.basename(file_path)
        name, _ = os.path.splitext(filename)
        output_path = os.path.join(KNOWLEDGE_DIR, f"{name}.md")
        
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(md_content)
            
        print(f"Converted to {output_path} using local extractors")

        ingest_to_vector_db(filename, md_content, domain_id, project_name, project_id, status)
        extract_and_ingest_graph(filename, md_content, domain_id, project_name, status)

        if document_id:
            doc = db.query(Document).filter(Document.id == document_id).first()
            if doc:
                has_conflicts = check_document_conflicts(filename)
                if has_conflicts:
                    doc.status = "NEEDS_REVIEW"
                    print("Set status to NEEDS_REVIEW due to conflicts.")
                else:
                    # SUCCESS: mark as EFFECTIVE so Smart Chat can retrieve it
                    doc.status = "EFFECTIVE"
                    print(f"Set status to EFFECTIVE.")
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
                    project_id = job.get('projectId')
                    
                    if file_path:
                        status = job.get('status', 'EFFECTIVE')
                        process_file(file_path, document_id, project_name, project_id, status)
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
