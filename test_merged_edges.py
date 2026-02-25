from neo4j import GraphDatabase
driver = GraphDatabase.driver("bolt://localhost:7687", auth=("neo4j", "nexis_password"))
with driver.session() as session:
    result = session.run("MATCH ()-[r:RELATION]->() WHERE size(r.types) > 1 RETURN type(r) as rel, r.types LIMIT 5")
    for r in result: print(f"Edge holds multiple types: {r['r.types']}")
driver.close()
