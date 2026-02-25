
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import chromadb
from chromadb.config import Settings
import os
import uvicorn
from dotenv import load_dotenv
import sys

# Load .env from project root
dotenv_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), '.env')
load_dotenv(dotenv_path)

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from python_services.db import get_db, Document, Project, SessionLocal
from sqlalchemy.orm import Session
from fastapi import Depends, Form, UploadFile, File
import traceback
import uuid
from neo4j import GraphDatabase

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows all origins
    allow_credentials=True,
    allow_methods=["*"],  # Allows all methods
    allow_headers=["*"],  # Allows all headers
)

# Configuration
import traceback
from neo4j import GraphDatabase

# Configuration
CHROMA_HOST = os.getenv('CHROMA_HOST', '127.0.0.1')
CHROMA_PORT = int(os.getenv('CHROMA_PORT', 8000))
NEO4J_URI = os.getenv('NEO4J_URI', 'bolt://localhost:7687')
NEO4J_USER = os.getenv('NEO4J_USER', 'neo4j')
NEO4J_PASSWORD = os.getenv('NEO4J_PASSWORD', 'nexis_password')
REDIS_HOST = os.getenv('REDIS_HOST', 'localhost')
REDIS_PORT = int(os.getenv('REDIS_PORT', 6380))

import redis
try:
    redis_client = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, decode_responses=True)
    print(f"RAG Server connected to Redis at {REDIS_HOST}:{REDIS_PORT}")
except Exception as e:
    redis_client = None
    print(f"Error connecting to Redis: {e}")

class SettingsUpdate(BaseModel):
    llm_provider: str

@app.get("/api/settings")
async def get_settings():
    if not redis_client:
        return {"llm_provider": "gemini"}
    provider = redis_client.get("nexis:settings:llm_provider")
    return {"llm_provider": provider if provider else "gemini"}

@app.put("/api/settings")
async def update_settings(req: SettingsUpdate):
    if not redis_client:
        return {"status": "error", "message": "Redis not connected"}
    redis_client.set("nexis:settings:llm_provider", req.llm_provider)
    return {"status": "success", "message": f"LLM Provider set to {req.llm_provider}"}

# Initialize ChromaDB
try:
    chroma_client = chromadb.HttpClient(host=CHROMA_HOST, port=CHROMA_PORT)
    chroma_collection = chroma_client.get_or_create_collection(name="nexis_knowledge")
    print(f"RAG Server connected to ChromaDB at {CHROMA_HOST}:{CHROMA_PORT}")
except Exception as e:
    print(f"Error connecting to ChromaDB: {e}")
    traceback.print_exc()
    chroma_collection = None

# Initialize Neo4j
try:
    neo4j_driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
    print(f"RAG Server connected to Neo4j at {NEO4J_URI}")
except Exception as e:
    print(f"Error connecting to Neo4j: {e}")
    traceback.print_exc()
    neo4j_driver = None

class QueryRequest(BaseModel):
    query: str
    n_results: int = 3

def query_graph(search_term):
    """
    Simple graph retrieval: Find nodes with names matching the search term (partial)
    and return their 1-hop relationships.
    """
    if not neo4j_driver:
        return []
    
    results = []
    try:
        with neo4j_driver.session() as session:
            # Enhanced Query for 3-Tier Taxonomy (Module -> SubModule -> Entity)
            # FILTER: Only consider documents with status = 'EFFECTIVE' (or null for legacy)
            result = session.run(
                """
                // Strategy 1: Direct Entity Match (Enriched with hierarchy)
                MATCH (e:Entity)
                WHERE toLower(e.name) CONTAINS toLower($term)
                MATCH (e)-[:MENTIONED_IN]->(d:Document)
                WHERE coalesce(d.status, 'EFFECTIVE') = 'EFFECTIVE'
                OPTIONAL MATCH (e)-[:BELONGS_TO]->(s:SubModule)-[:PART_OF]->(m:Module)
                RETURN e.name + ' (' + e.type + ') belongs to ' + coalesce(m.name, 'Unknown') + ' > ' + coalesce(s.name, 'General') + ' [Source: ' + d.name + ']' as fact
                LIMIT 10
                
                UNION
                
                // Strategy 2: SubModule Match
                MATCH (s:SubModule)
                WHERE toLower(s.name) CONTAINS toLower($term)
                MATCH (s)-[:PART_OF]->(m:Module)
                OPTIONAL MATCH (e:Entity)-[:BELONGS_TO]->(s)
                MATCH (e)-[:MENTIONED_IN]->(d:Document)
                WHERE coalesce(d.status, 'EFFECTIVE') = 'EFFECTIVE'
                RETURN 'SubModule ' + s.name + ' is part of ' + m.name + ' and contains: ' + e.name + ' [Source: ' + d.name + ']' as fact
                LIMIT 10

                UNION

                // Strategy 3: Module Match (Drill down)
                MATCH (m:Module)
                WHERE toLower(m.name) CONTAINS toLower($term)
                MATCH (s:SubModule)-[:PART_OF]->(m)
                MATCH (s)<-[:BELONGS_TO]-(e:Entity)-[:MENTIONED_IN]->(d:Document)
                WHERE coalesce(d.status, 'EFFECTIVE') = 'EFFECTIVE'
                RETURN 'Module ' + m.name + ' includes SubModule: ' + s.name + ' (Context from ' + d.name + ')' as fact
                LIMIT 10
                """,
                term=search_term
            )
            results = [record["fact"] for record in result if record["fact"]]
            print(f"Graph query for '{search_term}' found {len(results)} facts.")
    except Exception as e:
        print(f"Graph query error: {e}")
        
    return results

@app.get("/documents")
async def get_documents(db: Session = Depends(get_db)):
    docs = db.query(Document).filter(Document.status != "ARCHIVED").order_by(Document.createdAt.desc()).all()
    res = []
    for d in docs:
        project_name = d.project.name if d.project else None
        res.append({
            "id": d.id,
            "filename": d.filename,
            "version": d.version,
            "projectName": project_name,
            "jiraId": d.jiraId,
            "status": d.status,
            "errorMessage": getattr(d, 'error_message', None),
            "createdAt": d.createdAt.isoformat(),
            "updatedAt": d.updatedAt.isoformat()
        })
    return res

@app.put("/documents/{doc_id}/archive")
async def archive_document(doc_id: str, db: Session = Depends(get_db)):
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
        
    doc.status = "ARCHIVED"
    db.commit()
    
    # 2. Cleanup physical storage in Chroma (Vector DB)
    if chroma_collection:
        try:
            chroma_collection.delete(where={"source": doc.filename})
            print(f"Deleted vector chunks for {doc.filename}")
        except Exception as e:
            print(f"Warning: Failed to delete Chroma vectors for {doc.filename}: {e}")
            
    # 3. Mark Neo4j Graph elements as deleted (Optional MVP improvement)
    if neo4j_driver:
        try:
            with neo4j_driver.session() as session:
                session.run(
                    """
                    MATCH (d:Document {name: $filename})
                    SET d.status = 'DELETED'
                    """,
                    filename=doc.filename
                )
        except Exception as e:
            print(f"Warning: failed to mark DELETED in Neo4j for {doc.filename}: {e}")
            
    return {"message": f"Document {doc.filename} logically archived."}
    
@app.get("/documents/{filename}/conflicts")
async def get_document_conflicts(filename: str):
    if not neo4j_driver:
         return []
    try:
        with neo4j_driver.session() as session:
             result = session.run(
                 """
                 MATCH (new:Entity)-[r:CONTRADICTS]->(old:Entity)
                 MATCH (new)-[:MENTIONED_IN]->(d:Document {name: $filename})
                 RETURN 
                     new.name as new_rule,
                     old.name as old_rule,
                     r.old_source as old_source,
                     r.new_context as new_context,
                     r.old_context as old_context,
                     r.reason as reason,
                     r.suggestion as suggestion,
                     old.type as entity_type
                 """,
                 filename=filename
             )
             return [record.data() for record in result]
    except Exception as e:
        print(f"Error getting conflicts: {e}")
        return []

class ConflictResolutionRequest(BaseModel):
    new_rule: str
    old_rule: str
    action: str  # "accept_new" | "keep_old"

@app.post("/documents/{filename}/resolve-conflict")
async def resolve_individual_conflict(filename: str, req: ConflictResolutionRequest, db: Session = Depends(get_db)):
    if not neo4j_driver:
        return {"status": "error", "message": "Neo4j not connected"}
    
    try:
        with neo4j_driver.session() as session:
            # First, delete the specific contradiction edge
            session.run(
                """
                MATCH (new:Entity {name: $new_rule})-[r:CONTRADICTS]->(old:Entity {name: $old_rule})
                DELETE r
                """,
                new_rule=req.new_rule, old_rule=req.old_rule
            )
            
            # Apply the resolution logic to the entities
            if req.action == "accept_new":
                session.run(
                    """
                    MATCH (old:Entity {name: $old_rule})
                    SET old.status = 'DELETED'
                    """,
                    old_rule=req.old_rule
                )
            elif req.action == "keep_old":
                # We drop the new node because it's rejected
                session.run(
                    """
                    MATCH (new:Entity {name: $new_rule})
                    SET new.status = 'DELETED'
                    """,
                    new_rule=req.new_rule
                )
            else:
                 return {"status": "error", "message": "Invalid action"}
            
            # Check if there are any remaining conflicts for this document
            result = session.run(
                """
                MATCH (new:Entity)-[r:CONTRADICTS]->(old:Entity)
                MATCH (new)-[:MENTIONED_IN]->(d:Document {name: $filename})
                RETURN count(r) as remaining_conflicts
                """,
                filename=filename
            )
            remaining = result.single()["remaining_conflicts"]
            
            if remaining == 0:
                doc = db.query(Document).filter(Document.filename == filename).first()
                if doc and doc.status == "NEEDS_REVIEW":
                    doc.status = "EFFECTIVE"
                    db.commit()
                return {"status": "success", "message": "All conflicts resolved. Document is now EFFECTIVE.", "remaining": 0}
            
            return {"status": "success", "message": f"Conflict resolved. {remaining} remaining.", "remaining": remaining}
    except Exception as e:
        print(f"Error resolving conflict: {e}")
        return {"status": "error", "message": str(e)}

@app.get("/documents/{filename}/trace")
async def get_document_trace(filename: str):
    trace_data = {
        "markdown_content": None,
        "vector_chunk_count": 0,
        "graph_entities": []
    }
    
    # 1. Fetch Markdown Content
    name, _ = os.path.splitext(filename)
    # RAG API runs from nexis/ so knowledge dir should be at nexis/knowledge/
    kb_path = os.path.join(os.getcwd(), "knowledge", f"{name}.md")
    if os.path.exists(kb_path):
        with open(kb_path, 'r', encoding='utf-8') as f:
            trace_data["markdown_content"] = f.read()
            
    # 2. Fetch Vector Chunk Count and Details
    if chroma_collection:
        try:
            results = chroma_collection.get(where={"source": filename})
            if results and results['ids']:
                trace_data["vector_chunk_count"] = len(results['ids'])
                trace_data["vector_chunks"] = [
                    {"id": results['ids'][i], "text": results['documents'][i] if results['documents'] else ""}
                    for i in range(len(results['ids']))
                ]
            else:
                 trace_data["vector_chunks"] = []
        except Exception as e:
            print(f"Failed to get vector chunks for trace: {e}")
            trace_data["vector_chunks"] = []
            
    # 3. Fetch Graph Entities MENTIONED_IN this Document
    if neo4j_driver:
        try:
             with neo4j_driver.session() as session:
                 result = session.run(
                     """
                     MATCH (e:Entity)-[:MENTIONED_IN]->(d:Document {name: $filename})
                     RETURN e.name as name, e.type as type, coalesce(e.extracted_by, 'gemini') as extracted_by
                     """,
                     filename=filename
                 )
                 trace_data["graph_entities"] = [record.data() for record in result]
        except Exception as e:
             print(f"Failed to get graph entities for trace: {e}")
             
    return trace_data

@app.post("/retrieve")
async def retrieve(request: QueryRequest):
    context_items = []

    # 1. Vector Search
    if chroma_collection:
        try:
            results = chroma_collection.query(
                query_texts=[request.query],
                n_results=request.n_results
            )
            documents = results['documents'][0] if results['documents'] else []
            metadatas = results['metadatas'][0] if results['metadatas'] else []
            
            for doc, meta in zip(documents, metadatas):
                context_items.append({
                    "type": "vector",
                    "content": doc,
                    "source": meta.get("source", "unknown")
                })
        except Exception as e:
            print(f"Vector search failed: {e}")

    # 2. Graph Search (Simple Keyword Extraction from Query)
    # For MVP, we use the whole query or split by space. 
    # Ideal: Use LLM to extract entities first.
    # Here: Just try to match the full query or key terms? 
    # Let's take the first 2 significant words or the whole string if short.
    search_term = request.query.split(' ')[-1] if ' ' in request.query else request.query # Naive heuristic
    
    graph_facts = query_graph(search_term)
    for fact in graph_facts:
         context_items.append({
            "type": "graph",
            "content": fact,
            "source": "Neo4j"
        })

    return {"context": context_items}

@app.get("/graph/visualize")
async def get_graph_visualization(limit: int = 300, search_query: str = None, exclude_types: str = None, expand_node_id: str = None):
    nodes = []
    links = []
    
    # Parse excluded types (comma separated)
    excluded = [t.strip() for t in exclude_types.split(",")] if exclude_types else []
    
    if neo4j_driver:
        try:
            with neo4j_driver.session() as session:
                if expand_node_id:
                    # Specific node expansion - exact 1 hop
                    query = f"""
                    MATCH (n)
                    WHERE elementId(n) = $expand_node_id OR str(id(n)) = $expand_node_id
                    MATCH (n)-[r]-(m)
                    RETURN n as s, r, m as t
                    LIMIT {limit}
                    """
                    result = session.run(query, expand_node_id=expand_node_id)
                elif search_query:
                    # Search-driven progressive query
                    # Strategy: Prioritize Exact matches first. If none, fallback to CONTAINS. Limit the blast radius.
                    query = f"""
                    CALL {{
                        MATCH (n:Entity) WHERE toLower(n.name) = toLower($search_query) RETURN n
                        UNION
                        MATCH (n:Entity) WHERE toLower(n.name) CONTAINS toLower($search_query) RETURN n
                    }}
                    WITH n LIMIT {limit // 10} // Limit the number of seed nodes to prevent massive subgraphs
                    MATCH (n)-[r]-(m)
                    RETURN n as s, r, m as t
                    LIMIT {limit}
                    """
                    result = session.run(query, search_query=search_query)
                else:
                    # Default: get a comprehensive subgraph
                    query = f"""
                    MATCH (s)-[r]->(t)
                    RETURN s, r, t
                    LIMIT {limit}
                    """
                    result = session.run(query)
                
                seen_nodes = set()
                
                def get_node_props(node):
                    node_id = str(node.element_id) if hasattr(node, "element_id") else str(node.id)
                    label = list(node.labels)[0] if node.labels else "Unknown"
                    name = node.get("name", "Unnamed")
                    entity_type = node.get("type", label) # Default to label if type missing
                    
                    color = "#888"
                    val = 5
                    if "Module" in node.labels: color, val = "#f43f5e", 24 # Rose
                    elif "SubModule" in node.labels: color, val = "#f59e0b", 18 # Amber
                    elif "Document" in node.labels: color, val = "#10b981", 12 # Emerald
                    elif "Entity" in node.labels:
                        if entity_type == "Person/Role": color, val = "#94a3b8", 8 # Slate (less prominent)
                        elif entity_type == "System/Component": color, val = "#3b82f6", 12 # Blue
                        elif entity_type == "Organization": color, val = "#8b5cf6", 12 # Violet
                        elif entity_type == "TechnicalIdentifier": color, val = "#06b6d4", 10 # Cyan
                        elif entity_type == "BusinessConcept": color, val = "#ec4899", 14 # Pink
                        else: color, val = "#6366f1", 10 # Indigo (default for other entities)
                        
                    return {
                        "id": node_id,
                        "name": name,
                        "label": label,
                        "entity_type": entity_type,
                        "color": color,
                        "val": val
                    }

                for record in result:
                    source = record["s"]
                    target = record["t"]
                    rel = record["r"]
                    
                    s_props = get_node_props(source)
                    t_props = get_node_props(target)
                    
                    # Filtering: skip the relationship if either node falls into excluded types
                    if s_props["entity_type"] in excluded or t_props["entity_type"] in excluded:
                        continue
                    
                    # Process Source Node
                    if s_props["id"] not in seen_nodes:
                        nodes.append(s_props)
                        seen_nodes.add(s_props["id"])
                        
                    # Process Target Node
                    if t_props["id"] not in seen_nodes:
                        nodes.append(t_props)
                        seen_nodes.add(t_props["id"])
                    
                    # Process Relationship
                    rel_types = rel.get("types")
                    if rel_types and isinstance(rel_types, list):
                        display_type = " | ".join(rel_types)
                    else:
                        display_type = rel.type

                    links.append({
                        "source": s_props["id"],
                        "target": t_props["id"],
                        "type": display_type
                    })
                    
        except Exception as e:
            print(f"Graph visualization error: {e}")
            traceback.print_exc()
            
    return {"nodes": nodes, "links": links}

import redis
import json
import shutil
from fastapi import UploadFile, File, Form

# Redis Configuration
REDIS_HOST = os.getenv('REDIS_HOST', 'localhost')
REDIS_PORT = int(os.getenv('REDIS_PORT', 6379))
print(f"RAG API connecting to Redis at {REDIS_HOST}:{REDIS_PORT}")
redis_client = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, db=0)

# Ensure upload directory exists
UPLOAD_DIR = os.path.join(os.getcwd(), "raw_docs")
os.makedirs(UPLOAD_DIR, exist_ok=True)

@app.post("/upload")
async def upload_document(
    file: UploadFile = File(...),
    projectName: str = Form(None),
    jiraId: str = Form(None),
    version: str = Form("v1.0"),
    db: Session = Depends(get_db)
):
    try:
        file_path = os.path.join(UPLOAD_DIR, file.filename)
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        # 1. Update DB Tracking Postgres
        project_id = None
        if projectName:
            proj = db.query(Project).filter(Project.name == projectName).first()
            if not proj:
                proj = Project(id=str(uuid.uuid4()), name=projectName)
                db.add(proj)
                db.flush()
            project_id = proj.id
            
        doc_id = str(uuid.uuid4())
        doc = Document(
            id=doc_id,
            filename=file.filename,
            version=version,
            projectId=project_id,
            jiraId=jiraId,
            status="QUEUED"
        )
        db.add(doc)
        db.commit()
        
        # 2. Push to Redis Queue
        job = {
            "type": "ingest",
            "filePath": file_path,
            "filename": file.filename,
            "documentId": doc_id # Pass Postgres ID to worker
        }
        redis_client.rpush("nexis:ingest:queue", json.dumps(job))
        
        return {"status": "success", "message": f"File {file.filename} queued for ingestion.", "job_id": file.filename}
    except Exception as e:
        db.rollback()
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")

@app.get("/health")
def health():
    postgres_ok = False
    try:
        db = SessionLocal()
        db.execute("SELECT 1")
        postgres_ok = True
        db.close()
    except Exception:
        pass
        
    return {
        "status": "ok", 
        "chroma_connected": chroma_collection is not None,
        "neo4j_connected": neo4j_driver is not None,
        "redis_connected": redis_client.ping(),
        "postgres_connected": postgres_ok
    }

from google import genai
from google.genai import types

# Initialize Gemini
GEMINI_API_KEY = os.getenv('GEMINI_API_KEY')
try:
    if GEMINI_API_KEY:
        gemini_client = genai.Client(api_key=GEMINI_API_KEY)
        print("RAG Server connected to Gemini API")
    else:
        print("Warning: GEMINI_API_KEY not found")
        gemini_client = None
except Exception as e:
    print(f"Error connecting to Gemini: {e}")
    gemini_client = None

class ChatRequest(BaseModel):
    query: str
    history: list = [] # List of {role: str, content: str}
    n_results: int = 5

@app.post("/chat")
async def chat_endpoint(request: ChatRequest):
    # 1. Retrieve Context
    context_str = ""
    sources = []
    
    # Vector Search
    if chroma_collection:
        try:
            results = chroma_collection.query(query_texts=[request.query], n_results=request.n_results)
            if results['documents']:
                for doc, meta in zip(results['documents'][0], results['metadatas'][0]):
                    src = meta.get("source", "unknown")
                    context_str += f"- [Vector] {doc} (Source: {src})\n"
                    if src not in sources: sources.append(src)
        except Exception as e:
            print(f"Vector search failed: {e}")

    # Graph Search
    graph_facts = query_graph(request.query)
    for fact in graph_facts:
        context_str += f"- [Graph] {fact}\n"

    # 2. Augment Prompt
    system_instruction = """You are Nexis, an expert on Bill Business Standards (新一代票据业务). 
    Answer the user's question based strictly on the provided Context.
    If the Context has the answer, cite the source document names mentioned in the context.
    If the Context is insufficient, say you don't know."""
    
    full_prompt = f"""
    Context Information:
    {context_str}
    
    User Query: {request.query}
    
    Please answer the query using the context above.
    """
    
    # 3. Call LLM Streaming
    async def generate():
        if not gemini_client:
            yield "data: " + json.dumps({"error": "Gemini Client not initialized"}) + "\n\n"
            return
            
        try:
            response_stream = gemini_client.models.generate_content_stream(
                model='gemini-3-flash-preview',
                contents=full_prompt,
                config=types.GenerateContentConfig(
                    system_instruction=system_instruction
                )
            )
            for chunk in response_stream:
                if chunk.text:
                    yield "data: " + json.dumps({"text": chunk.text}) + "\n\n"
            
            # Send context at the end
            yield "data: " + json.dumps({"sources": sources, "context_used": context_str}) + "\n\n"
        except Exception as e:
            yield "data: " + json.dumps({"error": f"Error generating response: {str(e)}"}) + "\n\n"
            traceback.print_exc()

        yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8001)
