from neo4j import GraphDatabase
driver = GraphDatabase.driver("bolt://localhost:7687", auth=("neo4j", "nexis_password"))
with driver.session() as session:
    result = session.run("MATCH (n:Entity {name: '质押申请'})-[r]-(m) RETURN labels(m) as lbl, count(m) as count")
    for r in result: print(f"Label: {r['lbl']}, Count: {r['count']}")
driver.close()
