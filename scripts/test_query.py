import requests
import json
import sys

def query_rag(term):
    url = "http://localhost:8001/retrieve"
    payload = {"query": term, "n_results": 5}
    
    try:
        response = requests.post(url, json=payload)
        response.raise_for_status()
        data = response.json()
        
        print(f"\n=== Query Results for '{term}' ===\n")
        
        context = data.get("context", [])
        vectors = [c for c in context if c["type"] == "vector"]
        graphs = [c for c in context if c["type"] == "graph"]
        
        print(f"--- Vector Matches ({len(vectors)}) ---")
        for i, v in enumerate(vectors, 1):
            print(f"{i}. {v['content'][:200]}...") 
            print(f"   (Source: {v['source']})\n")
            
        print(f"--- Knowledge Graph Facts ({len(graphs)}) ---")
        for i, g in enumerate(graphs, 1):
            print(f"{i}. {g['content']}")
            
    except Exception as e:
        print(f"Error querying API: {e}")

if __name__ == "__main__":
    term = sys.argv[1] if len(sys.argv) > 1 else "票据"
    query_rag(term)
