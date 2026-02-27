from neo4j import GraphDatabase

driver = GraphDatabase.driver("bolt://localhost:7687", auth=("neo4j", "nexis_password"))
with driver.session() as session:
    result = session.run("""
        MATCH (n:Entity)
        WHERE n.name CONTAINS '出票登记' OR n.name CONTAINS '质押申请'
        RETURN n.name, n.type, count(*) as c
    """)
    records = list(result)
    for record in records:
        print(f"Name: '{record['n.name']}', Type: {record['n.type']}, Count: {record['c']}")
        
driver.close()
