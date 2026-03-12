import json
import chromadb
from neo4j import GraphDatabase
import os

NEO4J_URI = os.getenv('NEO4J_URI', 'bolt://neo4j:7687')
NEO4J_USER = os.getenv('NEO4J_USER', 'neo4j')
NEO4J_PASSWORD = os.getenv('NEO4J_PASSWORD', 'nexis_password')
CHROMA_HOST = os.getenv('CHROMA_HOST', 'chroma')

print("Connecting to DBs...")
neo4j_driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
chroma_client = chromadb.HttpClient(host=CHROMA_HOST, port=8000)

stats = {"documents": [], "taxonomy": [], "chunks": 0}

try:
    with neo4j_driver.session() as session:
        # Get documents and entity counts
        doc_result = session.run("MATCH (d:Document) RETURN d.name as name, d.projectName as project, SIZE([(d)<-[:MENTIONED_IN]-(e:Entity) | e]) AS entityCount")
        for record in doc_result:
            stats["documents"].append(dict(record))
            
        # Get Taxonomy Vault coverage
        tax_result = session.run("MATCH (t:TaxonomyNode)<-[:BELONGS_TO]-(e:Entity) RETURN t.name as category, COUNT(e) as entityCount, collect(e.name)[0..5] as examples ORDER BY entityCount DESC LIMIT 20")
        for record in tax_result:
            stats["taxonomy"].append(dict(record))
            
    # Get vector chunk counts
    collection = chroma_client.get_collection(name='nexis_eb0e86ee_7c30_4d2f_ad69_96367b20f7b0')
    stats["chunks"] = collection.count()

    print(json.dumps(stats, ensure_ascii=False, indent=2))
except Exception as e:
    print(e)
