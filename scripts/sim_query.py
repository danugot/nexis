from neo4j import GraphDatabase

driver = GraphDatabase.driver("bolt://localhost:7687", auth=("neo4j", "nexis_password"))
with driver.session() as session:
    print("--- Nodes containing 出票登记 ---")
    result = session.run("MATCH (n) WHERE n.name CONTAINS '出票登记' RETURN labels(n) as lbl, n.name as name")
    for r in result: print(f"[{r['lbl']}] {r['name']}")
driver.close()
