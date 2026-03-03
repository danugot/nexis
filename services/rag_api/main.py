
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
import chromadb
from chromadb.config import Settings
import os
import uvicorn
from dotenv import load_dotenv
import sys

from chromadb.api.types import Documents, EmbeddingFunction, Embeddings
from openai import OpenAI

# Load .env from project root
dotenv_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), '.env')
load_dotenv(dotenv_path)

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from python_services.db import get_db, Document, Domain, TaxonomyNode, SessionLocal, TaxonomySuggestion
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
UPLOAD_DIR = os.getenv('UPLOAD_DIR', '/app/raw_docs')
PROCESSED_DIR = os.getenv('KNOWLEDGE_DIR', '/app/processed_docs')

import redis
try:
    redis_client = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, decode_responses=True)
    print(f"RAG Server connected to Redis at {REDIS_HOST}:{REDIS_PORT}")
except Exception as e:
    redis_client = None
    print(f"Error connecting to Redis: {e}")

class SettingsUpdate(BaseModel):
    llm_provider: str

@app.get("/settings")
async def get_settings():
    if not redis_client:
        return {"llm_provider": "qwen-plus"}
    provider = redis_client.get("nexis:settings:llm_provider")
    return {"llm_provider": provider if provider else "qwen-plus"}

@app.put("/settings")
async def update_settings(req: SettingsUpdate):
    if not redis_client:
        return {"status": "error", "message": "Redis not connected"}
    redis_client.set("nexis:settings:llm_provider", req.llm_provider)
    return {"status": "success", "message": f"LLM Provider set to {req.llm_provider}"}

class DomainCreate(BaseModel):
    name: str
    description: Optional[str] = None

@app.get("/domains")
def get_domains(db: Session = Depends(get_db)):
    domains = db.query(Domain).order_by(Domain.createdAt.asc()).all()
    return [{"id": d.id, "name": d.name, "description": d.description} for d in domains]

@app.post("/domains")
def create_domain(domain: DomainCreate, db: Session = Depends(get_db)):
    db_domain = Domain(id=str(uuid.uuid4()), name=domain.name, description=domain.description)
    db.add(db_domain)
    db.commit()
    return {"status": "success", "id": db_domain.id}

@app.delete("/domains/{domain_id}")
def delete_domain(domain_id: str, db: Session = Depends(get_db)):
    domain = db.query(Domain).filter(Domain.id == domain_id).first()
    if domain:
        # Manually delete dependent records to avoid SQLAlchemy/PostgreSQL foreign key conflicts and orphans
        db.query(TaxonomySuggestion).filter(TaxonomySuggestion.domainId == domain_id).delete(synchronize_session=False)
        db.query(TaxonomyNode).filter(TaxonomyNode.domainId == domain_id).delete(synchronize_session=False)
        db.query(Document).filter(Document.domainId == domain_id).update({"domainId": None}, synchronize_session=False)
        
        db.delete(domain)
        db.commit()
        return {"status": "success"}
    raise HTTPException(status_code=404, detail="Domain not found")

class TaxonomyNodeCreate(BaseModel):
    name: str
    level: str
    parentId: Optional[str] = None

class TaxonomyNodeUpdate(BaseModel):
    name: str

@app.get("/domains/{domain_id}/taxonomy")
def get_taxonomy(domain_id: str, db: Session = Depends(get_db)):
    nodes = db.query(TaxonomyNode).filter(TaxonomyNode.domainId == domain_id).all()
    return [{"id": n.id, "name": n.name, "level": n.level, "parentId": n.parentId} for n in nodes]

@app.post("/domains/{domain_id}/taxonomy")
def create_taxonomy_node(domain_id: str, node: TaxonomyNodeCreate, db: Session = Depends(get_db)):
    db_node = TaxonomyNode(
        id=str(uuid.uuid4()),
        domainId=domain_id,
        name=node.name,
        level=node.level,
        parentId=node.parentId
    )
    db.add(db_node)
    db.commit()
    return {"status": "success", "id": db_node.id}

@app.delete("/domains/{domain_id}/taxonomy/{node_id}")
def delete_taxonomy_node(domain_id: str, node_id: str, db: Session = Depends(get_db)):
    node = db.query(TaxonomyNode).filter(TaxonomyNode.id == node_id, TaxonomyNode.domainId == domain_id).first()
    if node:
        db.delete(node)
        db.commit()
        return {"status": "success"}
    raise HTTPException(status_code=404, detail="Node not found")

@app.put("/domains/{domain_id}/taxonomy/{node_id}")
def update_taxonomy_node(domain_id: str, node_id: str, node_update: TaxonomyNodeUpdate, db: Session = Depends(get_db)):
    node = db.query(TaxonomyNode).filter(TaxonomyNode.id == node_id, TaxonomyNode.domainId == domain_id).first()
    if not node:
        raise HTTPException(status_code=404, detail="Node not found")
    node.name = node_update.name
    db.commit()
    return {"status": "success", "id": node.id, "name": node.name}

# --- AI Suggestions Endpoints ---

@app.get("/domains/{domain_id}/suggestions")
def get_taxonomy_suggestions(domain_id: str, db: Session = Depends(get_db)):
    suggestions = db.query(TaxonomySuggestion).filter(
        TaxonomySuggestion.domainId == domain_id
    ).order_by(TaxonomySuggestion.createdAt.desc()).all()
    
    return [{
        "id": s.id,
        "domainId": s.domainId,
        "proposedPath": s.proposedPath,
        "reasoning": s.reasoning,
        "status": s.status,
        "createdAt": s.createdAt.isoformat()
    } for s in suggestions]

class SuggestionFineTuneRequest(BaseModel):
    proposedPath: str

@app.put("/domains/{domain_id}/suggestions/{suggestion_id}/fine-tune")
def fine_tune_taxonomy_suggestion(domain_id: str, suggestion_id: str, req: SuggestionFineTuneRequest, db: Session = Depends(get_db)):
    suggestion = db.query(TaxonomySuggestion).filter(
        TaxonomySuggestion.id == suggestion_id, 
        TaxonomySuggestion.domainId == domain_id
    ).first()
    
    if not suggestion:
        raise HTTPException(status_code=404, detail="Suggestion not found")
        
    if suggestion.status != "PENDING":
        raise HTTPException(status_code=400, detail=f"Cannot fine-tune a {suggestion.status} suggestion")

    # 1. Update Postgres
    suggestion.proposedPath = req.proposedPath
    db.commit()

    # 2. Update Neo4j Node Name if it exists
    if neo4j_driver:
        try:
             with neo4j_driver.session() as session:
                 session.run(
                     """
                     MATCH (tx:TaxonomyNode:PendingSuggestion {id: $sugg_id})
                     SET tx.name = $new_name
                     """,
                     sugg_id=suggestion_id, new_name=req.proposedPath
                 )
        except Exception as e:
             print(f"Warning: Failed to sync fine-tuned suggestion name to Neo4j: {e}")

    return {"status": "success", "message": "Suggestion fine-tuned successfully", "proposedPath": suggestion.proposedPath}

class SuggestionResolutionRequest(BaseModel):
    action: str # 'APPROVE' or 'REJECT'
    approvedPath: Optional[str] = None
    level: Optional[str] = "CATEGORY"
    parentId: Optional[str] = None

@app.put("/domains/{domain_id}/suggestions/{suggestion_id}")
def resolve_taxonomy_suggestion(domain_id: str, suggestion_id: str, req: SuggestionResolutionRequest, db: Session = Depends(get_db)):
    suggestion = db.query(TaxonomySuggestion).filter(
        TaxonomySuggestion.id == suggestion_id, 
        TaxonomySuggestion.domainId == domain_id
    ).first()
    
    if not suggestion:
        raise HTTPException(status_code=404, detail="Suggestion not found")
        
    if suggestion.status != "PENDING":
        raise HTTPException(status_code=400, detail=f"Suggestion already {suggestion.status}")

    if req.action == "APPROVE":
        if not req.approvedPath:
             raise HTTPException(status_code=400, detail="approvedPath is required to approve.")
             
        # Create an actual taxonomy node
        # Since we use Prisma/Neo4j merged model, we write to SQL, then it triggers real graph creation
        path_parts = [p.strip() for p in req.approvedPath.split(">") if p.strip()]
        
        current_parent_id = None
        current_level_idx = 0
        LEVEL_NAMES = ["CATEGORY", "MODULE", "SUBMODULE", "FEATURE", "SUBFEATURE"]
        final_node_id = None
        
        neo4j_nodes_to_merge = []
        
        for part_name in path_parts:
            # Check if this node exists in SQL
            existing_node = db.query(TaxonomyNode).filter(
                TaxonomyNode.domainId == domain_id,
                TaxonomyNode.name == part_name,
                TaxonomyNode.parentId == current_parent_id
            ).first()
            
            if existing_node:
                final_node_id = existing_node.id
                current_parent_id = existing_node.id
                # Attempt to sync index if found:
                try:
                    current_level_idx = LEVEL_NAMES.index(existing_node.level) + 1
                except ValueError:
                    current_level_idx += 1
            else:
                final_node_id = str(uuid.uuid4())
                mapped_level = LEVEL_NAMES[current_level_idx] if current_level_idx < len(LEVEL_NAMES) else "FEATURE"
                new_node = TaxonomyNode(
                    id=final_node_id,
                    domainId=domain_id,
                    name=part_name,
                    level=mapped_level,
                    parentId=current_parent_id
                )
                db.add(new_node)
                db.flush()
                neo4j_nodes_to_merge.append({
                    "id": final_node_id,
                    "name": part_name,
                    "parentId": current_parent_id
                })
                current_parent_id = final_node_id
                current_level_idx += 1
                
        suggestion.status = "APPROVED"
        db.commit()
        
        # Now, we should also formally run MERGE in Neo4j to link any waiting nodes
        # The frontend/agent may have just pointed `BELONGS_TO` to the `suggestion_id`.
        if neo4j_driver:
             try:
                 with neo4j_driver.session() as session:
                     # 1. Create the real Category in Neo4j
                     for node_data in neo4j_nodes_to_merge:
                         session.run(
                             """
                             MERGE (nx:TaxonomyNode {id: $nid}) 
                             SET nx.name = $name 
                             WITH nx 
                             MATCH (dom:Domain {id: $domain_id}) 
                             MERGE (nx)-[:IN_DOMAIN]->(dom)
                             """,
                             nid=node_data["id"], name=node_data["name"], domain_id=domain_id
                         )
                         if node_data["parentId"]:
                              session.run(
                                  """
                                  MATCH (child:TaxonomyNode {id: $child_id}) 
                                  MATCH (parent:TaxonomyNode {id: $parent_id}) 
                                  MERGE (child)-[:PART_OF]->(parent)
                                  """,
                                  child_id=node_data["id"], parent_id=node_data["parentId"]
                              )
                          
                     # 2. Re-wire orphaned entities from suggestion ID to standard taxonomy ID
                     session.run(
                         """
                         MATCH (e:Entity)-[r:BELONGS_TO]->(sugg:TaxonomyNode {id: $sugg_id})
                         MATCH (real:TaxonomyNode {id: $real_id})
                         MERGE (e)-[:BELONGS_TO]->(real)
                         DELETE r
                         """,
                         sugg_id=suggestion_id, real_id=final_node_id
                     )
                     
             except Exception as e:
                 print(f"Failed to reconcile graph for suggestion {suggestion_id}: {e}")
                 
        return {"status": "success", "message": "Suggestion approved and nodes migrated", "newNodeId": final_node_id}
        
    elif req.action == "REJECT":
        suggestion.status = "REJECTED"
        db.commit()
        # Optionally, delete the placeholder nodes from Neo4j (for now just leave them orphaned or let them fall back to general document level)
        return {"status": "success", "message": "Suggestion rejected"}
    
    else:
        raise HTTPException(status_code=400, detail="Invalid action")

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
        for i in range(0, len(input), batch_size):
            batch = input[i:i + batch_size]
            print(f"[DIAGNOSTIC] RAG API: Embedding batch {i//batch_size + 1} via DashScope...")
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

# Initialize ChromaDB
try:
    chroma_client = chromadb.HttpClient(host=CHROMA_HOST, port=CHROMA_PORT)
    chroma_collection = chroma_client.get_or_create_collection(
        name="nexis_knowledge",
        embedding_function=dashscope_ef
    )
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
    domain_id: str = None
    project_name: str = None
    document_ids: Optional[List[str]] = None
    status_filter: List[str] = ["EFFECTIVE", "DRAFT", "SANDBOX"] # Default to searching all available knowledge in RAG unless restricted

def query_graph(search_term, domain_id=None, project_name=None, status_filter=None, document_ids=None):
    """
    Simple graph retrieval: Find nodes with names matching the search term (partial)
    and return their 1-hop relationships.
    """
    if not neo4j_driver:
        return []
    
    s_filter = status_filter if status_filter else ["EFFECTIVE", "DRAFT", "SANDBOX"]
    doc_ids_list = document_ids if document_ids else []
    
    results = []
    try:
        with neo4j_driver.session() as session:
            # Add domain filter if specified
            domain_match = ""
            if domain_id:
                domain_match = f"MATCH (d)-[:IN_DOMAIN]->(:Domain {{id: '{domain_id}'}})"

            project_cond = f"d.projectName CONTAINS '{project_name}'" if project_name else "false"
            id_cond = "d.id IN $doc_ids" if doc_ids_list else "false"
            
            doc_filter = f"WHERE coalesce(d.status, 'EFFECTIVE') = 'EFFECTIVE' OR (coalesce(d.status, '') IN $status_filter AND ({id_cond} OR {project_cond}))"

            result = session.run(
                f"""
                // Strategy 1: Direct Entity Match (Enriched with hierarchy)
                MATCH (e:Entity)
                WHERE toLower(e.name) CONTAINS toLower($term)
                MATCH (e)-[:MENTIONED_IN]->(d:Document)
                {doc_filter}
                OPTIONAL MATCH (e)-[:BELONGS_TO]->(tx:TaxonomyNode)
                {domain_match}
                RETURN e.name + ' (' + e.type + ') belongs to Category: ' + coalesce(tx.name, 'Unknown') + ' [Source: ' + d.name + ']' as fact
                LIMIT 10
                
                UNION
                
                // Strategy 2: Taxonomy Match
                MATCH (tx:TaxonomyNode)
                WHERE toLower(tx.name) CONTAINS toLower($term)
                {domain_match}
                MATCH (e:Entity)-[:BELONGS_TO]->(tx)
                MATCH (e)-[:MENTIONED_IN]->(d:Document)
                {doc_filter}
                RETURN 'Category ' + tx.name + ' contains: ' + coalesce(e.name, 'No entities') + ' [Source: ' + d.name + ']' as fact
                LIMIT 15
                
                UNION
                
                // Strategy 3: Multi-hop Relationship Traversal
                MATCH (e:Entity)
                WHERE toLower(e.name) CONTAINS toLower($term)
                MATCH (e)-[r]-(m:Entity)
                WHERE type(r) <> 'MENTIONED_IN' AND type(r) <> 'BELONGS_TO' AND type(r) <> 'IN_DOMAIN' AND type(r) <> 'CONTRADICTS'
                MATCH (e)-[:MENTIONED_IN]->(d:Document)
                {doc_filter}
                {domain_match}
                RETURN e.name + ' [Relation: ' + type(r) + '] ' + m.name + ' [Source: ' + d.name + ']' as fact
                LIMIT 20
                """,
                term=search_term,
                status_filter=s_filter,
                doc_ids=doc_ids_list
            )
            import re
            def sanitize_fact(fact):
                # Remove common file extensions
                fact = re.sub(r'\.(docx|pdf|md|txt|xlsx|pptx)', '', fact, flags=re.IGNORECASE)
                # Remove date prefixes like 20221227_
                fact = re.sub(r'\b\d{8}_', '', fact)
                return fact

            results = [sanitize_fact(record["fact"]) for record in result if record["fact"]]
            print(f"Graph query for '{search_term}' found {len(results)} facts.")
    except Exception as e:
        print(f"Graph query error: {e}")
        
    return results

@app.get("/graph/trace/{entity_name}")
async def trace_graph_dependencies(
    entity_name: str, 
    depth: int = 2, 
    project_name: Optional[str] = None, 
    domain_id: Optional[str] = None,
    document_ids: Optional[str] = None,
    status_filter: str = "EFFECTIVE,DRAFT,SANDBOX"
):
    """
    Returns a subgraph of nodes and relationships connected to the given entity.
    Used for 'Blast Radius' analysis. Supports scoping by project and domain.
    """
    if not neo4j_driver:
        return {"nodes": [], "edges": []}
    
    nodes = []
    edges = []
    
    try:
        with neo4j_driver.session() as session:
            # Construction of scoping filters
            project_cond = f"d.projectName CONTAINS '{project_name}'" if project_name else "false"
            
            doc_ids_list = document_ids.split(",") if document_ids else []
            id_cond = "d.id IN $doc_ids" if doc_ids_list else "false"
            s_filter = status_filter.split(',')
            
            doc_filter = f"WHERE coalesce(d.status, 'EFFECTIVE') = 'EFFECTIVE' OR (coalesce(d.status, '') IN $status_filter AND ({id_cond} OR {project_cond}))"
            project_match = f"MATCH (start)-[:MENTIONED_IN]->(d:Document) {doc_filter}"
            
            domain_match = ""
            if domain_id:
                domain_match = "MATCH (start)-[:IN_DOMAIN]->(:Domain {id: $domain_id})"

            # Query to get entity and its neighbors up to N depth
            query = f"""
            MATCH (start:Entity)
            WHERE toLower(start.name) CONTAINS toLower($name)
            {project_match}
            {domain_match}
            MATCH (start)-[r*1..{depth}]-(neighbor:Entity)
            // Filter out common metadata relationships
            WHERE ALL(rel IN r WHERE type(rel) <> 'MENTIONED_IN' AND type(rel) <> 'BELONGS_TO' AND type(rel) <> 'IN_DOMAIN' AND type(rel) <> 'PART_OF')
            RETURN start, r, neighbor
            LIMIT 100
            """
            
            result = session.run(query, name=entity_name, project_name=project_name, domain_id=domain_id, doc_ids=doc_ids_list, status_filter=s_filter)
            
            seen_nodes = set()
            seen_edges = set()
            
            for record in result:
                start_node = record["start"]
                neighbor_node = record["neighbor"]
                relationships = record["r"]
                
                for n in [start_node, neighbor_node]:
                    if n.id not in seen_nodes:
                        nodes.append({
                            "id": n.id,
                            "name": n.get("name"),
                            "type": list(n.labels)[0] if n.labels else "Entity",
                            "properties": dict(n)
                        })
                        seen_nodes.add(n.id)
                
                for rel in relationships:
                    rel_id = f"{rel.start_node.id}-{rel.type}-{rel.end_node.id}"
                    if rel_id not in seen_edges:
                        edges.append({
                            "source": rel.start_node.id,
                            "target": rel.end_node.id,
                            "type": rel.type,
                            "properties": dict(rel)
                        })
                        seen_edges.add(rel_id)
                        
            return {"nodes": nodes, "edges": edges}
    except Exception as e:
        print(f"Graph trace error: {e}")
        return {"nodes": [], "edges": [], "error": str(e)}

@app.get("/documents")
async def get_documents(db: Session = Depends(get_db)):
    docs = db.query(Document).filter(~Document.status.in_(["ARCHIVED", "SANDBOX"])).order_by(Document.createdAt.desc()).all()
    res = []
    for d in docs:
        domain_name = d.domain.name if d.domain else None
        res.append({
            "id": d.id,
            "filename": d.filename,
            "version": d.version,
            "projectName": d.projectName,
            "domainName": domain_name,
            "domainId": d.domainId,
            "jiraId": d.jiraId,
            "status": d.status,
            "errorMessage": getattr(d, 'error_message', None),
            "createdAt": d.createdAt.isoformat(),
            "updatedAt": d.updatedAt.isoformat()
        })
    return res

@app.get("/projects/{project_name}/versions")
async def get_project_versions(project_name: str, db: Session = Depends(get_db)):
    """
    Returns all document versions for a specific project.
    """
    docs = db.query(Document).filter(
        Document.projectName.ilike(f"%{project_name}%"),
        ~Document.status.in_(["ARCHIVED", "SANDBOX"])
    ).order_by(Document.version.desc()).all()
    
    return [
        {
            "id": d.id,
            "filename": d.filename,
            "version": d.version,
            "projectName": d.projectName,
            "status": d.status,
            "createdAt": d.createdAt.isoformat()
        } for d in docs
    ]

@app.get("/documents/{doc_id}/content")
async def get_document_content(doc_id: str, db: Session = Depends(get_db)):
    """
    Returns the processed markdown content of a document by its ID.
    """
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
        
    name, _ = os.path.splitext(doc.filename)
    kb_path = os.path.join(PROCESSED_DIR, f"{name}.md")
    
    if not os.path.exists(kb_path):
        raise HTTPException(status_code=404, detail=f"Processed markdown not found at {kb_path}")
        
    try:
        with open(kb_path, 'r', encoding='utf-8') as f:
            content = f.read()
            return {"id": doc_id, "filename": doc.filename, "version": doc.version, "content": content}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read file: {str(e)}")

@app.put("/documents/{doc_id}/archive")
async def archive_document(doc_id: str, db: Session = Depends(get_db)):
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
        
    doc.status = "ARCHIVED"
    db.commit()
    
    # 2. Cleanup physical storage in Chroma (Vector DB)
    trace_collection = chroma_collection
    if doc and doc.domainId:
        safe_id = doc.domainId.replace('-', '_')
        try:
            trace_collection = chroma_client.get_collection(name=f"nexis_{safe_id}")
        except Exception:
            pass

    if trace_collection:
        try:
            trace_collection.delete(where={"source": doc.filename})
            print(f"Deleted vector chunks for {doc.filename}")
        except Exception as e:
            print(f"Warning: Failed to delete Chroma vectors for {doc.filename}: {e}")
    # 3. Mark Neo4j Graph elements as deleted (Optional MVP improvement)
    if neo4j_driver:
        try:
            with neo4j_driver.session() as session:
                # 1. Hard delete the document and all relationships pointing to it
                session.run(
                    """
                    MATCH (d:Document {name: $filename})
                    DETACH DELETE d
                    """,
                    filename=doc.filename
                )
                # 2. Sweep for orphaned entities that no longer belong to ANY document
                session.run(
                    """
                    MATCH (e:Entity) 
                    WHERE NOT (e)-[:MENTIONED_IN]->(:Document) 
                    DETACH DELETE e
                    """
                )
        except Exception as e:
            print(f"Warning: failed to mark DELETED in Neo4j for {doc.filename}: {e}")
            
@app.post("/documents/{doc_id}/re-ingest")
async def re_ingest_document(doc_id: str, db: Session = Depends(get_db)):
    # 1. Archive first to cleanup Neo4j and Chroma
    await archive_document(doc_id, db)
    
    # 2. Get document details
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
        
    doc.status = "QUEUED"
    db.commit()
    
    # 3. Push to Redis Queue
    file_path = os.path.join(UPLOAD_DIR, doc.filename)
    job = {
        "type": "ingest",
        "filePath": file_path,
        "filename": doc.filename,
        "projectName": doc.projectName,
        "documentId": doc.id 
    }
    redis_client.rpush("nexis:ingest:queue", json.dumps(job))
    
    return {"status": "success", "message": f"Document {doc.filename} re-queued for processing."}
    
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
    # The worker saves to processed_docs/
    kb_path = os.path.join("/app/processed_docs", f"{name}.md")
    if os.path.exists(kb_path):
        with open(kb_path, 'r', encoding='utf-8') as f:
            trace_data["markdown_content"] = f.read()
            
    # 2. Fetch Vector Chunk Count and Details
    db = SessionLocal()
    doc = db.query(Document).filter(Document.filename == filename).first()
    
    trace_collection = chroma_collection
    if doc and doc.domainId:
        safe_id = doc.domainId.replace('-', '_')
        try:
            trace_collection = chroma_client.get_collection(name=f"nexis_{safe_id}")
        except Exception:
            pass
    db.close()

    if trace_collection:
        try:
            results = trace_collection.get(where={"source": filename})
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
                     RETURN e.name as name, e.type as type, coalesce(e.extracted_by, 'Unknown') as extracted_by
                     """,
                     filename=filename
                 )
                 trace_data["graph_entities"] = [record.data() for record in result]
        except Exception as e:
             print(f"Failed to get graph entities for trace: {e}")
             
    return trace_data

@app.post("/retrieve")
async def retrieve(request: QueryRequest, db: Session = Depends(get_db)):
    context_items = []

    # 1. Vector Search
    where_clause = None
    
    from sqlalchemy import or_, and_, String
    
    # Base filter: always respect the status_filter (which defaults to EFFECTIVE, DRAFT, SANDBOX)
    base_query = db.query(Document).filter(Document.status.in_(request.status_filter))
    
    conditions = [Document.status == 'EFFECTIVE']
    
    if request.project_name:
        conditions.append(
            and_(
                Document.status.in_(["DRAFT", "SANDBOX"]),
                Document.projectName.ilike(f"%{request.project_name}%")
            )
        )
        
    if request.document_ids:
        conditions.append(
            and_(
                Document.status.in_(["DRAFT", "SANDBOX"]),
                Document.id.in_(request.document_ids)
            )
        )
        
    doc_query = base_query.filter(or_(*conditions))
    
    matching_docs = doc_query.all()
    
    filenames = [d.filename for d in matching_docs]
    
    if not filenames:
        # If no docs match the project/status, vector search should yield nothing
        v_ids, v_docs, v_metas = [], [], []
        vector_ranks, bm25_ranks, bm25_ranked = {}, {}, []
        collection = None # Skip vector search
    elif len(filenames) == 1:
        where_clause = {"source": filenames[0]}
    else:
        where_clause = {"source": {"$in": filenames}}

    collection = chroma_collection if 'collection' not in locals() or collection is not None else None
    
    if request.domain_id and collection is not None:
        safe_id = request.domain_id.replace('-', '_')
        try:
            collection = chroma_client.get_or_create_collection(
                name=f"nexis_{safe_id}",
                embedding_function=dashscope_ef
            )
        except Exception:
            pass

    if collection:
        try:
            # DIAGNOSTIC: Log collection status
            count = collection.count()
            print(f"[DIAGNOSTIC] Current collection: {collection.name}, Count: {count}")
            
            # If domain collection is empty, check global nexis_knowledge
            if count == 0 and collection.name != "nexis_knowledge":
                try:
                    global_count = chroma_collection.count()
                    print(f"[DIAGNOSTIC] Domain empty. Global collection (nexis_knowledge) Count: {global_count}")
                except Exception:
                    pass
            
            # 1a. Semantic Search (Top-K)
            vector_k = max(20, request.n_results * 4) 
            vector_results = collection.query(
                query_texts=[request.query],
                n_results=vector_k,
                where=where_clause
            )
            v_ids = vector_results['ids'][0] if vector_results['ids'] else []
            v_docs = vector_results['documents'][0] if vector_results['documents'] else []
            v_metas = vector_results['metadatas'][0] if vector_results['metadatas'] else []
            v_distances = vector_results['distances'][0] if 'distances' in vector_results and vector_results['distances'] else []
            
            # DIAGNOSTIC: Log Top-V results
            for i in range(min(3, len(v_ids))):
                dist = v_distances[i] if i < len(v_distances) else "N/A"
                print(f"[DIAGNOSTIC] Vector Top-{i+1}: ID={v_ids[i]}, Source={v_metas[i].get('source')}, Score={dist}")

            vector_ranks = {vid: rank for rank, vid in enumerate(v_ids)}
            
            # 1b. BM25 Lexical Search (Over the entire domain collection)
            all_chunks = collection.get(where=where_clause)
            all_ids = all_chunks.get('ids', [])
            all_docs = all_chunks.get('documents', [])
            all_metas = all_chunks.get('metadatas', [])
            
            bm25_ranks = {}
            bm25_ranked = []
            if all_docs:
                tokenized_corpus = [list(jieba.cut(str(doc))) for doc in all_docs]
                bm25 = BM25Okapi(tokenized_corpus)
                tokenized_query = list(jieba.cut(request.query))
                bm25_scores = bm25.get_scores(tokenized_query)
                
                # Zip and sort by BM25 score DESC
                bm25_ranked = sorted(zip(all_ids, bm25_scores, all_docs, all_metas), key=lambda x: x[1], reverse=True)
                # Assign rank only to those with scores > 0
                bm25_ranks = {vid: rank for rank, (vid, score, doc, meta) in enumerate(bm25_ranked) if score > 0} 

                # DIAGNOSTIC: Log Top-BM25 results
                for i in range(min(3, len(bm25_ranked))):
                    vid, score, doc, meta = bm25_ranked[i]
                    if score > 0:
                        print(f"[DIAGNOSTIC] BM25 Top-{i+1}: ID={vid}, Source={meta.get('source')}, Score={score}")
            
            # 1c. Reciprocal Rank Fusion (RRF)
            k_rrf = 60
            rrf_scores = {}
            doc_map = {}
            
            # Fuse semantic hits
            for vid, doc, meta in zip(v_ids, v_docs, v_metas):
                doc_map[vid] = (doc, meta)
                v_rank = vector_ranks.get(vid, 1000)
                b_rank = bm25_ranks.get(vid, 1000)
                rrf_scores[vid] = (1.0 / (k_rrf + v_rank)) + (1.0 / (k_rrf + b_rank))
                
            # Fuse top lexical hits (that might have been missed by Semantic top-K)
            for vid, score, doc, meta in bm25_ranked[:20]:
                if vid not in doc_map and score > 0:
                    doc_map[vid] = (doc, meta)
                    v_rank = 1000 # Penalize for failing semantic retrieval
                    b_rank = bm25_ranks.get(vid, 1000)
                    rrf_scores[vid] = (1.0 / (k_rrf + v_rank)) + (1.0 / (k_rrf + b_rank))
                    
            # 1d. Sort & Select Top N
            sorted_rrf = sorted(rrf_scores.items(), key=lambda x: x[1], reverse=True)
            
            for vid, score in sorted_rrf[:request.n_results]:
                doc, meta = doc_map[vid]
                # HARD CUTOFF: If RRF score is terrible (e.g., both rankings > 50), skip it entirely
                # or if the user question has NO keyword matches and NOT the #1 vector match.
                # Here we just take the mathematically best RRF bounds.
                context_items.append({
                    "type": "vector",
                    "content": doc,
                    "source": meta.get("source", "unknown"),
                    "rrf_score": score
                })
        except Exception as e:
            print(f"Hybrid search failed: {e}")
            traceback.print_exc()

    # 2. Graph Search (Simple Keyword Extraction from Query)
    # Use jieba to extract meaningful nouns/terms, filter out stop words
    ignore_words = {"功能", "实现", "主要", "哪些", "怎么", "什么", "如何", "系统", "模块", "项目", "docx", "pdf", "md", "txt", "xlsx", "pptx"}
    parts = []
    for word in jieba.cut(request.query):
        w = word.strip()
        if len(w) > 1 and w not in ignore_words:
            parts.append(w)
            
    search_terms = parts if parts else [request.query]
    
    # DIAGNOSTIC: Search Term Expansion
    expanded_terms = []
    for term in search_terms:
        expanded_terms.append(term)
        if term == "贸背":
            expanded_terms.extend(["贸易", "背景", "贸背资料"])
        elif term == "贸易":
            expanded_terms.append("贸易背景")
            
    search_terms = list(set(expanded_terms))
    print(f"[DIAGNOSTIC] Final Graph Search Terms: {search_terms}")
    
    graph_facts_set = set()
    for term in search_terms:
        print(f"[DIAGNOSTIC] Fallback keyword Graph Search for: {term}")
        facts = query_graph(term, domain_id=request.domain_id, project_name=request.project_name, status_filter=request.status_filter)
        graph_facts_set.update(facts)

    graph_facts = list(graph_facts_set)[:40] # Increase to 40 for better coverage
    # DIAGNOSTIC: Log first 5 graph facts
    for idx, fact in enumerate(graph_facts[:5]):
        print(f"[DIAGNOSTIC] Graph Fact {idx+1}: {fact}")
    for fact in graph_facts:
         context_items.append({
            "type": "graph",
            "content": fact,
            "source": "Neo4j"
        })

    print(f"[DIAGNOSTIC] Retrieval completed. Vector: {len([i for i in context_items if i['type']=='vector'])}, Graph: {len([i for i in context_items if i['type']=='graph'])}")
    return {"context": context_items}

@app.get("/graph/visualize")
async def get_graph_visualization(limit: int = 300, search_query: str = None, exclude_types: str = None, expand_node_id: str = None, domain_id: str = None):
    nodes = []
    links = []
    
    # Parse excluded types (comma separated)
    excluded = [t.strip() for t in exclude_types.split(",")] if exclude_types else []
    
    if neo4j_driver:
        try:
            with neo4j_driver.session() as session:
                domain_match = ""
                if domain_id:
                    domain_match = f"MATCH (n)-[*1..3]-(:Domain {{id: '{domain_id}'}})"

                if expand_node_id:
                    # Specific node expansion - exact 1 hop
                    query = f"""
                    MATCH (n)
                    WHERE elementId(n) = $expand_node_id OR toString(id(n)) = $expand_node_id
                    {domain_match}
                    MATCH (n)-[r]-(m)
                    RETURN n as s, r, m as t
                    LIMIT {limit}
                    """
                    result = session.run(query, expand_node_id=expand_node_id)
                elif search_query:
                    # Search-driven progressive query
                    query = f"""
                    CALL {{
                        MATCH (n:Entity) WHERE toLower(n.name) = toLower($search_query) RETURN n
                        UNION
                        MATCH (n:Entity) WHERE toLower(n.name) CONTAINS toLower($search_query) RETURN n
                    }}
                    WITH n LIMIT {limit // 10} // Limit the number of seed nodes to prevent massive subgraphs
                    {domain_match}
                    MATCH (n)-[r]-(m)
                    RETURN n as s, r, m as t
                    LIMIT {limit}
                    """
                    result = session.run(query, search_query=search_query)
                else:
                    # Default: get a comprehensive subgraph bound to domain
                    query = f"""
                    MATCH (n:Entity)
                    {domain_match}
                    WITH DISTINCT n LIMIT {limit // 2}
                    MATCH (n)-[r]-(m)
                    RETURN DISTINCT n as s, r, m as t
                    LIMIT {limit}
                    """
                    result = session.run(query)
                
                seen_nodes = set()
                seen_links = set()
                
                def get_node_props(node):
                    node_id = str(node.element_id) if hasattr(node, "element_id") else str(node.id)
                    label = list(node.labels)[0] if node.labels else "Unknown"
                    name = node.get("name", "Unnamed")
                    entity_type = node.get("type", label) # Default to label if type missing
                    
                    color = "#888"
                    val = 5
                    if "TaxonomyNode" in node.labels: 
                        if "PendingSuggestion" in node.labels:
                            color, val = "#f97316", 20 # Orange, slightly smaller than formal amber
                            # Add a special property to hint frontend it's pending
                            name = "⏳ " + name 
                        else:
                            color, val = "#f59e0b", 22 # Amber
                    elif "Domain" in node.labels: color, val = "#f43f5e", 26 # Rose
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
                    link_key = f"{s_props['id']}--{display_type}--{t_props['id']}"
                    if link_key not in seen_links:
                        links.append({
                            "source": s_props["id"],
                            "target": t_props["id"],
                            "type": display_type
                        })
                        seen_links.add(link_key)
                    
        except Exception as e:
            print(f"Graph visualization error: {e}")
            traceback.print_exc()
            
    return {"nodes": nodes, "links": links}

class SubgraphIngestRequest(BaseModel):
    domainId: str
    categoryId: str  # Can be a real TaxonomyNode ID or a TaxonomySuggestion ID
    sourceDocument: str
    status: str = "EFFECTIVE" # Default to EFFECTIVE
    projectName: Optional[str] = None
    extractedBy: str = "Unknown"
    entities: list
    relationships: list

@app.post("/graph/ingest_subgraph")
async def ingest_subgraph(req: SubgraphIngestRequest, db: Session = Depends(get_db)):
    if not neo4j_driver:
        raise HTTPException(status_code=500, detail="Neo4j driver not connected")
        
    try:
        with neo4j_driver.session() as session:
            # 1. Ensure Domain anchor
            session.run("MERGE (dom:Domain {id: $domain_id})", domain_id=req.domainId)
            
            # 2. Document anchor
            cypher_doc = """
                MERGE (d:Document {name: $filename})
                SET d.status = $status, d.version = 'latest', d.ingested_at = datetime()
            """
            if req.projectName:
                cypher_doc += " SET d.projectName = $project_name "
            cypher_doc += """
                MERGE (dom:Domain {id: $domain_id})
                MERGE (d)-[:IN_DOMAIN]->(dom)
            """
            session.run(cypher_doc, filename=req.sourceDocument, domain_id=req.domainId, project_name=req.projectName, status=req.status)
            
            # 3. Create Nodes
            for node in req.entities:
                session.run(
                    """
                    MERGE (n:Entity {name: $name}) 
                    SET n.type = $type, n.extracted_by = $extracted_by
                    WITH n
                    MATCH (d:Document {name: $filename})
                    MERGE (n)-[:MENTIONED_IN]->(d)
                    """,
                    name=node["name"], type=node.get("type", "UNKNOWN"), 
                    extracted_by=req.extractedBy,
                    filename=req.sourceDocument
                )
                
                # Check if this categoryId is a Suggestion in Postgres
                sugg = db.query(TaxonomySuggestion).filter(TaxonomySuggestion.id == req.categoryId).first()
                if sugg:
                    session.run(
                        """
                        MATCH (n:Entity {name: $name}) 
                        MERGE (tx:TaxonomyNode:PendingSuggestion {id: $cat_id})
                        SET tx.name = $sugg_name, tx.level = 'SUBMODULE'
                        MERGE (n)-[:BELONGS_TO]->(tx)
                        """,
                        name=node["name"], cat_id=req.categoryId, sugg_name=sugg.proposedPath
                    )
                else:
                    # Link to category (whether strict or suggested)
                    # It doesn't matter for Neo4j, we just attach it to an identifier
                    session.run(
                        """
                        MATCH (n:Entity {name: $name}) 
                        MERGE (tx:TaxonomyNode {id: $cat_id})
                        MERGE (n)-[:BELONGS_TO]->(tx)
                        """,
                        name=node["name"], cat_id=req.categoryId
                    )
            
            # 4. Create Edges
            for edge in req.relationships:
                if "source" not in edge or "target" not in edge or "type" not in edge:
                    continue
                session.run(
                    """
                    MATCH (a:Entity {name: $source}), (b:Entity {name: $target})
                    MERGE (a)-[r:RELATION]->(b)
                    ON CREATE SET r.types = [$relation]
                    ON MATCH SET r.types = CASE WHEN NOT $relation IN r.types THEN r.types + $relation ELSE r.types END
                    """,
                    source=edge["source"], target=edge["target"], relation=edge["type"]
                )
                
        return {"status": "success", "nodes_created": len(req.entities), "relationships_created": len(req.relationships)}
    except Exception as e:
        print(f"Error in ingest_subgraph: {e}")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

import redis
import json
import shutil
import jieba
from rank_bm25 import BM25Okapi
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
    domainId: str = Form(None),
    projectName: str = Form(None),
    jiraId: str = Form(None),
    version: str = Form("v1.0"),
    status: str = Form("DRAFT"), # Optional status override
    db: Session = Depends(get_db)
):
    try:
        file_path = os.path.join(UPLOAD_DIR, file.filename)
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        doc_id = str(uuid.uuid4())
        doc = Document(
            id=doc_id,
            filename=file.filename,
            version=version,
            projectName=projectName,
            domainId=domainId,
            jiraId=jiraId,
            status=status # Use the provided status
        )
        db.add(doc)
        db.commit()
        
        # 2. Push to Redis Queue
        job = {
            "type": "ingest",
            "filePath": file_path,
            "filename": file.filename,
            "projectName": projectName,
            "documentId": doc_id,
            "status": status # Pass status to worker
        }
        redis_client.rpush("nexis:ingest:queue", json.dumps(job))
        
        return {"status": "success", "file_id": doc_id, "message": f"File {file.filename} queued for ingestion."}
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

# OpenAI/Qwen Configuration
DASHSCOPE_API_KEY = os.getenv('DASHSCOPE_API_KEY')
qwen_client = None
if DASHSCOPE_API_KEY:
    try:
        qwen_client = OpenAI(
            api_key=DASHSCOPE_API_KEY,
            base_url="https://dashscope.aliyuncs.com/compatible-mode/v1"
        )
        print("RAG Server connected to Qwen/DashScope API")
    except Exception as e:
        print(f"Error connecting to Qwen: {e}")

# Initialize Gemini
GEMINI_API_KEY = os.getenv('GEMINI_API_KEY')
gemini_client = None
if GEMINI_API_KEY:
    try:
        gemini_client = genai.Client(api_key=GEMINI_API_KEY)
        print("RAG Server connected to Gemini API")
    except Exception as e:
        print(f"Error connecting to Gemini: {e}")

class ChatRequest(BaseModel):
    query: str
    history: list = [] # List of {role: str, content: str}
    n_results: int = 5
    domain_id: str = None

@app.post("/chat")
async def chat_endpoint(request: ChatRequest, db: Session = Depends(get_db)):
    # 1. Retrieve Context
    context_str = ""
    sources = []
    
    # Vector Search
    collection = chroma_collection
    if request.domain_id:
        safe_id = request.domain_id.replace('-', '_')
        try:
            collection = chroma_client.get_or_create_collection(
                name=f"nexis_{safe_id}",
                embedding_function=dashscope_ef
            )
        except Exception:
            pass

    if collection:
        try:
            results = collection.query(query_texts=[request.query], n_results=request.n_results)
            if results['documents']:
                for doc, meta in zip(results['documents'][0], results['metadatas'][0]):
                    src = meta.get("source", "unknown")
                    context_str += f"- [Vector] {doc} (Source: {src})\n"
                    if src not in sources: sources.append(src)
        except Exception as e:
            print(f"Vector search failed: {e}")

    # 2. Add Graph Context
    graph_facts = query_graph(request.query, domain_id=request.domain_id, status_filter=request.status_filter)
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
        # Check setting from Redis
        provider = "qwen-plus"
        if redis_client:
            stored_provider = redis_client.get("nexis:settings:llm_provider")
            if stored_provider:
                provider = stored_provider
        
        print(f"[DIAGNOSTIC] RAG API: Using LLM Provider: {provider}")

        if provider.startswith("qwen") and qwen_client:
            try:
                response = qwen_client.chat.completions.create(
                    model=provider if provider != "qwen" else "qwen-plus",
                    messages=[
                        {"role": "system", "content": system_instruction},
                        {"role": "user", "content": full_prompt}
                    ],
                    stream=True
                )
                for chunk in response:
                    if chunk.choices and chunk.choices[0].delta.content:
                        yield "data: " + json.dumps({"text": chunk.choices[0].delta.content}) + "\n\n"
                
                # Send context at the end
                yield "data: " + json.dumps({"sources": sources, "context_used": context_str}) + "\n\n"
            except Exception as e:
                yield "data: " + json.dumps({"error": f"Qwen Error: {str(e)}"}) + "\n\n"
        
        elif gemini_client:
            try:
                response_stream = gemini_client.models.generate_content_stream(
                    model='gemini-1.5-flash',
                    contents=full_prompt,
                    config=types.GenerateContentConfig(
                        system_instruction=system_instruction
                    )
                )
                for chunk in response_stream:
                    if chunk.text:
                        yield "data: " + json.dumps({"text": chunk.text}) + "\n\n"
                
                yield "data: " + json.dumps({"sources": sources, "context_used": context_str}) + "\n\n"
            except Exception as e:
                yield "data: " + json.dumps({"error": f"Gemini Error: {str(e)}"}) + "\n\n"
        else:
            yield "data: " + json.dumps({"error": "No LLM client initialized"}) + "\n\n"

        yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8001)
