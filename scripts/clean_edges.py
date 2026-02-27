from neo4j import GraphDatabase
driver = GraphDatabase.driver("bolt://localhost:7687", auth=("neo4j", "nexis_password"))
with driver.session() as session:
    print("Deleting all 'RELATION' edges to prepare for deduplication format...")
    session.run("MATCH ()-[r:RELATION]-() DELETE r")
    print("Cleaned.")
driver.close()
