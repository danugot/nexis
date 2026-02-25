import os
from neo4j import GraphDatabase

driver = GraphDatabase.driver("bolt://localhost:7687", auth=("neo4j", "nexis_password"))

def clear_conflicts():
    with driver.session() as session:
        result = session.run("MATCH ()-[r:CONTRADICTS]->() DELETE r")
        print("Cleared old CONTRADICTS relationships.")
        
        # Also let's set the status of any ERROR or NEEDS_REVIEW documents back to QUEUED so the worker picks them up again
        result = session.run('MATCH (d:Document) WHERE d.status IN ["ERROR", "NEEDS_REVIEW"] SET d.status = "QUEUED"')
        print("Reset stuck documents to QUEUED.")

if __name__ == "__main__":
    clear_conflicts()
    driver.close()
