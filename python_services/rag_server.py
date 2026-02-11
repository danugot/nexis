
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import chromadb
from chromadb.config import Settings
import os
import uvicorn

app = FastAPI()

# Configuration
import traceback
from neo4j import GraphDatabase

# Configuration
CHROMA_HOST = os.getenv('CHROMA_HOST', '127.0.0.1')
CHROMA_PORT = int(os.getenv('CHROMA_PORT', 8000))
NEO4J_URI = os.getenv('NEO4J_URI', 'bolt://localhost:7687')
NEO4J_USER = os.getenv('NEO4J_USER', 'neo4j')
NEO4J_PASSWORD = os.getenv('NEO4J_PASSWORD', 'nexis_password')

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
    
    query = """
    MATCH (n)-[r]->(m)
    WHERE n.name CONTAINS $term OR m.name CONTAINS $term
    RETURN n.name AS source, type(r) AS rel, m.name AS target
    LIMIT 10
    """
    try:
        results = []
        with neo4j_driver.session() as session:
            records = session.run(query, term=search_term)
            for record in records:
                results.append(f"{record['source']} -[{record['rel']}]-> {record['target']}")
        return results
    except Exception as e:
        print(f"Graph query error: {e}")
        return []

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

@app.get("/health")
def health():
    return {"status": "ok", "chroma_connected": collection is not None}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8001)
