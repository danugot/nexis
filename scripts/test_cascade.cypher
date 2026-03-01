MATCH (d:Document {name: 'test_doc'}) DETACH DELETE d;
MATCH (e:Entity) WHERE NOT (e)-[:MENTIONED_IN]->(:Document) DETACH DELETE e;
