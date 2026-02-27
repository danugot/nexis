import psycopg2
import redis
import chromadb
from neo4j import GraphDatabase
import os
from dotenv import load_dotenv

load_dotenv()

print("🚨 INITIALIZING SYSTEM DATA WIPE (RETAINING BUSINESS LINES) 🚨")

# 1. Clear PostgreSQL (Keep Domains and empty others securely)
print("\n[1] Clearing PostgreSQL (Documents, Messages, Sessions, Suggestions, Nodes)...")
try:
    db_url = os.getenv("DATABASE_URL", "postgresql://postgres:nexis_postgres@localhost:5433/nexis_chat")
    conn = psycopg2.connect(db_url)
    cur = conn.cursor()
    # Delete child tables first to avoid foreign key violations, keep 'Domain'
    cur.execute('DELETE FROM "TaxonomySuggestion";')
    cur.execute('DELETE FROM "TaxonomyNode";')
    cur.execute('DELETE FROM "Document";')
    cur.execute('DELETE FROM "Message";')
    cur.execute('DELETE FROM "Session";')
    # cur.execute('DELETE FROM "Project";') # optional if legacy
    conn.commit()
    print("✅ PostgreSQL cleansed.")
except Exception as e:
    print(f"❌ PostgreSQL Error: {e}")
finally:
    if 'conn' in locals():
        cur.close()
        conn.close()

# 2. Clear Neo4j
print("\n[2] Clearing Neo4j Knowledge Graph...")
try:
    neo4j_uri = os.getenv("NEO4J_URI", "bolt://localhost:7687")
    neo4j_user = os.getenv("NEO4J_USER", "neo4j")
    neo4j_pass = os.getenv("NEO4J_PASSWORD", "nexis_password")
    driver = GraphDatabase.driver(neo4j_uri, auth=(neo4j_user, neo4j_pass))
    with driver.session() as session:
        # Match all nodes and relationships and delete them
        session.run("MATCH (n) DETACH DELETE n;")
    print("✅ Neo4j cleansed.")
except Exception as e:
    print(f"❌ Neo4j Error: {e}")
finally:
    if 'driver' in locals():
        driver.close()

# 3. Clear ChromaDB
print("\n[3] Clearing ChromaDB Vector Store...")
try:
    chroma_host = os.getenv("CHROMA_HOST", "localhost")
    chroma_port = int(os.getenv("CHROMA_PORT", "8000"))
    chroma_client = chromadb.HttpClient(host=chroma_host, port=chroma_port)
    # The get_or_create ensures we don't crash if it's already gone
    # But to fully reset, we delete the collection and recreate it empty
    for collection in chroma_client.list_collections():
        chroma_client.delete_collection(name=collection.name)
        print(f"   - Deleted collection: {collection.name}")
    print("✅ ChromaDB cleansed.")
except Exception as e:
    print(f"❌ ChromaDB Error: {e}")

# 4. Clear Redis Cache/Queues
print("\n[4] Clearing Redis...")
try:
    redis_url = os.getenv("REDIS_URL", "redis://localhost:6380/0")
    r = redis.from_url(redis_url, decode_responses=True)
    
    # We want to clear everything except LLM Provider settings if they exist
    # Safer to just MATCH nexis:* and delete what isn't a setting (or just flush db but save some settings)
    llm_provider = r.get("nexis:settings:llm_provider")
    
    r.flushdb()
    
    # Restore critical settings
    if llm_provider:
        r.set("nexis:settings:llm_provider", llm_provider)
        print(f"   - Restored LLM setting: {llm_provider}")
        
    print("✅ Redis cleansed.")
except Exception as e:
    print(f"❌ Redis Error: {e}")

print("\n🎉 DATA WIPE COMPLETE. You can now start fresh uploads!")
