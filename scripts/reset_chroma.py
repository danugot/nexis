import chromadb
client = chromadb.HttpClient(host="localhost", port=8000)
for collection in client.list_collections():
    print(f"Deleting collection: {collection.name}")
    client.delete_collection(name=collection.name)
print("ChromaDB reset complete.")
