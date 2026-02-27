import os
from neo4j import GraphDatabase
uri = os.getenv('NEO4J_URI', 'bolt://localhost:7687')
user = os.getenv('NEO4J_USER', 'neo4j')
password = os.getenv('NEO4J_PASSWORD', 'nexis_password')
driver = GraphDatabase.driver(uri, auth=(user, password))
filename = '【产品需求规格说明书】新一代票据20220608.docx'
with driver.session() as session:
    result = session.run("MATCH (e:Entity)-[:MENTIONED_IN]->(d:Document {name: $filename}) RETURN count(e) as count", filename=filename)
    print('Entities Extracted:', result.single()['count'])
