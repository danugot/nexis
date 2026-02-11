
import os
import sys
import redis
import json
import time
import docx
import chromadb
# import google.generativeai as genai # Deprecated
from google import genai
from google.genai import types
from neo4j import GraphDatabase
from dotenv import load_dotenv

load_dotenv()

# Configuration
REDIS_HOST = os.getenv('REDIS_HOST', 'localhost')
REDIS_PORT = int(os.getenv('REDIS_PORT', 6379))
CHROMA_HOST = os.getenv('CHROMA_HOST', '127.0.0.1')
CHROMA_PORT = int(os.getenv('CHROMA_PORT', 8000))
NEO4J_URI = os.getenv('NEO4J_URI', 'bolt://localhost:7687')
NEO4J_USER = os.getenv('NEO4J_USER', 'neo4j')
NEO4J_PASSWORD = os.getenv('NEO4J_PASSWORD', 'nexis_password')
GEMINI_API_KEY = os.getenv('GEMINI_API_KEY')
QUEUE_NAME = 'nexis:ingest:queue'
KNOWLEDGE_DIR = 'knowledge'

if GEMINI_API_KEY:
    client = genai.Client(api_key=GEMINI_API_KEY)
    # model = ... (not needed for Client.models.generate_content)
else:
    client = None
    print("Warning: GEMINI_API_KEY not set...")

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

def ingest_to_vector_db(filename, content):
    if not chroma_collection:
        return
    try:
        chunks = [p for p in content.split('\n\n') if p.strip()]
        ids = [f"{filename}_{i}" for i in range(len(chunks))]
        metadatas = [{"source": filename, "chunk_index": i} for i in range(len(chunks))]
        if chunks:
            chroma_collection.add(documents=chunks, metadatas=metadatas, ids=ids)
            print(f"Ingested {len(chunks)} chunks into ChromaDB.")
    except Exception as e:
        print(f"Error ingesting to ChromaDB: {e}")

def extract_and_ingest_graph(filename, content):
    if not client or not neo4j_driver:
        print("Skipping Graph Ingestion (Client or Neo4j missing).")
        return

    print("Extracting Graph Entities...")
    prompt = f"""
    Extract knowledge graph entities and relationships from the following text.
    Return STRICT JSON format:
    {{
      "nodes": [{{"id": "UniqueName", "type": "EntityType", "properties": {{ ... }} }}],
      "edges": [{{"source": "SourceNodeID", "target": "TargetNodeID", "type": "RELATIONSHIP_TYPE", "properties": {{ ... }} }}]
    }}
    
    Text:
    {content[:10000]} 
    """
    
    try:
        response = client.models.generate_content(
            model='gemini-2.0-flash', # use stable model
            contents=prompt,
            config=types.GenerateContentConfig(response_mime_type='application/json')
        )
        text = response.text
        data = json.loads(text)
        
        with neo4j_driver.session() as session:
            # Ingest Nodes
            for node in data.get("nodes", []):
                query = f"MERGE (n:`{node['type']}` {{name: $id}}) SET n += $props"
                session.run(query, id=node['id'], props=node.get('properties', {}))
            
            # Ingest Edges
            for edge in data.get("edges", []):
                query = f"""
                MATCH (a {{name: $source}}), (b {{name: $target}})
                MERGE (a)-[r:`{edge['type']}`]->(b)
                SET r += $props
                """
                session.run(query, source=edge['source'], target=edge['target'], props=edge.get('properties', {}))
        
        print(f"Ingested {len(data.get('nodes', []))} nodes and {len(data.get('edges', []))} edges into Neo4j.")

    except Exception as e:
        print(f"Error in Graph Ingestion: {e}")

def process_file(file_path):
    print(f"Processing file: {file_path}")
    if not os.path.exists(file_path):
        return False

    try:
        doc = docx.Document(file_path)
        full_text = [para.text for para in doc.paragraphs]
        md_content = '\n\n'.join(full_text)
        
        filename = os.path.basename(file_path)
        name, _ = os.path.splitext(filename)
        output_path = os.path.join(KNOWLEDGE_DIR, f"{name}.md")
        
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(md_content)
            
        print(f"Converted to {output_path}")

        ingest_to_vector_db(filename, md_content)
        extract_and_ingest_graph(filename, md_content)

        return True
    except Exception as e:
        print(f"Error converting file: {e}")
        return False

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
                    
                    if file_path:
                        process_file(file_path)
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
