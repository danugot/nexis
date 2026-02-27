
import chromadb
from chromadb.config import Settings
import os

CHROMA_HOST = os.getenv('CHROMA_HOST', 'localhost')
CHROMA_PORT = int(os.getenv('CHROMA_PORT', 8000))

def verify():
    try:
        client = chromadb.HttpClient(host=CHROMA_HOST, port=CHROMA_PORT)
        collection = client.get_collection("nexis_knowledge")
        
        count = collection.count()
        print(f"Total documents in ChromaDB: {count}")
        
        if count > 0:
            results = collection.peek(limit=5)
            print("Sample documents:")
            for i, doc in enumerate(results['documents']):
                print(f"[{i}] {doc}")
                print(f"    Metadata: {results['metadatas'][i]}")
        else:
            print("Collection is empty.")

    except Exception as e:
        print(f"Error verification: {e}")

if __name__ == "__main__":
    verify()
