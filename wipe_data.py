import os
import sys
from sqlalchemy import create_engine, text
from neo4j import GraphDatabase
import chromadb

# --- Config ---
POSTGRES_URL = "postgresql://postgres:nexis_postgres@localhost:5433/nexis_chat"
NEO4J_URI = "bolt://localhost:7687"
NEO4J_USER = "neo4j"
NEO4J_PASSWORD = "nexis_password"

# Add path for chromadb client
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

def wipe_legacy_data():
    print("WARNING: This script will WIPE ALL Nexis application data except the newly configured Domains/Taxonomies.")
    
    # 1. Wipe Postgres: Documents, Messages, Sessions
    print("\n--- 1. Wiping PostgreSQL Data ---")
    engine = create_engine(POSTGRES_URL)
    with engine.begin() as conn:
        print("  Deleting all Messages...")
        conn.execute(text('DELETE FROM "Message";'))
        print("  Deleting all Sessions...")
        conn.execute(text('DELETE FROM "Session";'))
        print("  Deleting all Documents...")
        conn.execute(text('DELETE FROM "Document";'))

    # 2. Wipe ChromaDB
    print("\n--- 2. Wiping ChromaDB Vector Data ---")
    try:
        chroma_client = chromadb.HttpClient(host='localhost', port=8000)
        collections = chroma_client.list_collections()
        for c in collections:
            chroma_client.delete_collection(name=c.name)
            print(f"  Deleted ChromaDB Collection: {c.name}")
        if not collections:
            print("  No ChromaDB collections found to delete.")
    except Exception as e:
        print(f"  Failed to wipe ChromaDB: {e}")

    # 3. Wipe Neo4j Graph
    print("\n--- 3. Wiping Neo4j Graph Data ---")
    try:
        neo4j_driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
        with neo4j_driver.session() as session:
            # Delete everything EXCEPT Domain, Module, SubModule (Taxonomy Vault configuration)
            result = session.run("""
                MATCH (n)
                WHERE NOT n:Domain AND NOT n:Module AND NOT n:SubModule
                DETACH DELETE n
                RETURN count(n) as count
            """)
            deleted_count = result.single()["count"]
            print(f"  Deleted {deleted_count} generic nodes and their relationships from Neo4j.")
        neo4j_driver.close()
    except Exception as e:
        print(f"  Failed to wipe Neo4j: {e}")

    print("\n✅ All legacy and orphaned data has been wiped. Your Nexis instance is now clean and ready for Multi-Domain testing.")

if __name__ == "__main__":
    wipe_legacy_data()
