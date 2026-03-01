import chromadb
import os
from dotenv import load_dotenv

load_dotenv()

from openai import OpenAI
from chromadb.api.types import Documents, EmbeddingFunction, Embeddings

class DashScopeEmbeddingFunction(EmbeddingFunction):
    def __init__(self, api_key, model_name="text-embedding-v4"):
        self.client = OpenAI(
            api_key=api_key,
            base_url="https://dashscope.aliyuncs.com/compatible-mode/v1"
        )
        self.model_name = model_name

    def __call__(self, input: Documents) -> Embeddings:
        if not input:
            return []
        response = self.client.embeddings.create(
            model=self.model_name,
            input=input
        )
        return [data.embedding for data in response.data]

dashscope_ef = DashScopeEmbeddingFunction(api_key=os.getenv('DASHSCOPE_API_KEY'))

try:
    chroma_client = chromadb.HttpClient(host='localhost', port=8000)
    collection = chroma_client.get_or_create_collection(
        name="test_embedding_v4",
        embedding_function=dashscope_ef
    )
    
    collection.add(
        documents=["衣服的质量杠杠的"],
        metadatas=[{"source": "test"}],
        ids=["doc1"]
    )
    
    results = collection.query(
        query_texts=["这件衣服质量如何？"],
        n_results=1
    )
    print("Test passed! Results:")
    print(results)
    
    # Clean up
    chroma_client.delete_collection("test_embedding_v4")
except Exception as e:
    print(f"Error: {e}")
