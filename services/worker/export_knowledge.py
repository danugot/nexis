import os
import sys
from neo4j import GraphDatabase
from dotenv import load_dotenv

load_dotenv()

NEO4J_URI = os.getenv('NEO4J_URI', 'bolt://localhost:7687')
NEO4J_USER = os.getenv('NEO4J_USER', 'neo4j')
NEO4J_PASSWORD = os.getenv('NEO4J_PASSWORD', 'nexis_password')

def export_current_reality(output_file="current_reality.md"):
    driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
    
    print("📸 Snapshotting current effective knowledge...")
    
    query = """
    MATCH (m:Module)<-[:PART_OF]-(s:SubModule)
    OPTIONAL MATCH (s)<-[:BELONGS_TO]-(e:Entity)
    // Filter: Include Entity ONLY if it's linked to an EFFECTIVE document
    MATCH (e)-[:MENTIONED_IN]->(d:Document)
    WHERE coalesce(d.status, 'EFFECTIVE') = 'EFFECTIVE'
    
    RETURN 
        m.name as Module,
        s.name as SubModule,
        e.name as Entity,
        e.type as Type,
        d.name as Source,
        d.version as Version
    ORDER BY Module, SubModule, Entity
    """
    
    try:
        with driver.session() as session:
            result = session.run(query)
            records = list(result)
            
            if not records:
                print("No effective knowledge found.")
                return

            with open(output_file, "w") as f:
                f.write(f"# Nexis Knowledge Base: Live Specification\n")
                f.write(f"**Generated At**: {os.popen('date').read().strip()}\n\n")
                
                current_module = ""
                current_sub = ""
                
                for r in records:
                    # Module Header
                    if r['Module'] != current_module:
                        f.write(f"\n## 📦 {r['Module']}\n")
                        current_module = r['Module']
                        current_sub = "" # Reset sub
                    
                    # SubModule Header
                    if r['SubModule'] != current_sub:
                        f.write(f"\n### 🔹 {r['SubModule']}\n")
                        current_sub = r['SubModule']
                    
                    # Entity Item
                    # Using a format that highlights Source
                    version_tag = f" (v{r['Version']})" if r['Version'] else ""
                    f.write(f"- **{r['Entity']}** `[{r['Type']}]`\n")
                    f.write(f"  - *Source: {r['Source']}{version_tag}*\n")
                    
        print(f"✅ Export complete: {output_file}")
            
    except Exception as e:
        print(f"Error querying Neo4j: {e}")
    finally:
        driver.close()

if __name__ == "__main__":
    export_current_reality()
