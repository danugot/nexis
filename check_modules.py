from neo4j import GraphDatabase

driver = GraphDatabase.driver("bolt://localhost:7687", auth=("neo4j", "nexis_password"))
with driver.session() as session:
    print("--- Modules ---")
    result = session.run("MATCH (m:Module) RETURN m.name, count(*) as count ORDER BY count DESC LIMIT 5")
    for r in result: print(f"Module: {r['m.name']}, Count: {r['count']}")
    
    print("\n--- SubModules ---")
    result = session.run("MATCH (s:SubModule) RETURN s.name, count(*) as count ORDER BY count DESC LIMIT 5")
    for r in result: print(f"SubModule: {r['s.name']}, Count: {r['count']}")
driver.close()
