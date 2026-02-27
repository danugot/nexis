import sys, os
from neo4j import GraphDatabase

NEO4J_URI = "bolt://localhost:7687"
NEO4J_USER = "neo4j"
NEO4J_PASSWORD = "nexis_password"

driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
with driver.session() as session:
    result = session.run("MATCH (n:Entity) RETURN n.extracted_by as provider, count(n) as count")
    for record in result:
        print(f"Provider: {record['provider']}, Count: {record['count']}")
driver.close()
