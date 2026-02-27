from neo4j import GraphDatabase
driver = GraphDatabase.driver("bolt://localhost:7687", auth=("neo4j", "nexis_password"))
with driver.session() as session:
    result = session.run("MATCH (e:Entity {name: '出票登记'})-[r:RELATION]->(t {name: '出票申请'}) RETURN r.type as rel_type")
    for r in result: print(f"Edge type: {r['rel_type']}")
driver.close()
