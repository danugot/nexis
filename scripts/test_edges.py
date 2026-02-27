from neo4j import GraphDatabase
driver = GraphDatabase.driver("bolt://localhost:7687", auth=("neo4j", "nexis_password"))
with driver.session() as session:
    result = session.run("MATCH (e:Entity {name: '出票登记'})-[r]->(t) RETURN type(r) as rel, labels(t) as target, t.name as t_name")
    for r in result: print(f"-[{r['rel']}]-> {r['target']} {r['t_name']}")
driver.close()
