import sys
import os
sys.path.append(os.getcwd())
from python_services.db import SessionLocal, Document
from neo4j import GraphDatabase

NEO4J_URI = os.getenv('NEO4J_URI', 'bolt://localhost:7687')
NEO4J_USER = os.getenv('NEO4J_USER', 'neo4j')
NEO4J_PASSWORD = os.getenv('NEO4J_PASSWORD', 'nexis_password')

db = SessionLocal()
neo4j_driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))

docs = db.query(Document).filter(Document.projectName != None).all()
with neo4j_driver.session() as session:
    for doc in docs:
        print(f"Syncing {doc.filename} -> projectName: {doc.projectName}")
        session.run(
            "MATCH (d:Document {name: $filename}) SET d.projectName = $pn",
            filename=doc.filename, pn=doc.projectName
        )
print("done")
