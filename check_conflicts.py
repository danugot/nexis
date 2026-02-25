import os
from neo4j import GraphDatabase
from dotenv import load_dotenv

load_dotenv()

NEO4J_URI = os.getenv('NEO4J_URI', 'bolt://localhost:7687')
NEO4J_USER = os.getenv('NEO4J_USER', 'neo4j')
NEO4J_PASSWORD = os.getenv('NEO4J_PASSWORD', 'nexis_password')

def print_conflicts():
    driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
    
    query = """
    MATCH (new:Entity)-[r:CONTRADICTS]->(old:Entity)
    MATCH (new)-[:MENTIONED_IN]->(new_doc:Document)
    MATCH (old)-[:MENTIONED_IN]->(old_doc:Document)
    RETURN 
        new.name as NewRule, 
        new_doc.name as NewSource,
        old.name as OldRule, 
        old_doc.name as OldSource,
        r.reason as Reason,
        r.detected_at as Time
    ORDER BY r.detected_at DESC
    """
    
    try:
        with driver.session() as session:
            result = session.run(query)
            records = list(result)
            
            if not records:
                print("\n✅ No conflicts detected in the knowledge graph.")
                return

            print(f"\n⚠️  FOUND {len(records)} CONFLICTS ⚠️\n")
            for i, r in enumerate(records, 1):
                print(f"[{i}] CONTRADICTION DETECTED")
                print(f"    🔴 New:  {r['NewRule']} (from {r['NewSource']})")
                print(f"    🟡 Old:  {r['OldRule']} (from {r['OldSource']})")
                print(f"    💡 Reason: {r['Reason']}")
                print("-" * 60)
                
    except Exception as e:
        print(f"Error querying Neo4j: {e}")
    finally:
        driver.close()

def print_changelog(doc_pattern):
    driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
    
    print(f"\n🔍 Analyzing new knowledge from document matching: '{doc_pattern}'...\n")
    
    query = """
    MATCH (d:Document)
    WHERE d.name CONTAINS $doc_pattern
    MATCH (e:Entity)-[:MENTIONED_IN]->(d)
    OPTIONAL MATCH (e)-[:BELONGS_TO]->(s:SubModule)-[:PART_OF]->(m:Module)
    RETURN 
        d.name as Source,
        m.name as Module,
        s.name as SubModule,
        e.name as Entity,
        e.type as Type
    ORDER BY Module, SubModule
    LIMIT 50
    """
    
    try:
        with driver.session() as session:
            result = session.run(query, doc_pattern=doc_pattern)
            records = list(result)
            
            if not records:
                print(f"No entities found for document matching '{doc_pattern}'.")
                return

            current_module = ""
            for r in records:
                mod_blob = f"{r['Module']} > {r['SubModule']}"
                if mod_blob != current_module:
                    print(f"\n📂 [{mod_blob}]")
                    current_module = mod_blob
                
                print(f"   - {r['Entity']} ({r['Type']})")
                
    except Exception as e:
        print(f"Error querying Neo4j: {e}")
    finally:
        driver.close()

if __name__ == "__main__":
    print_conflicts()
    print_changelog("0716")
