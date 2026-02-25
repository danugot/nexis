import os
import requests
from neo4j import GraphDatabase

class ConflictDetector:
    def __init__(self, neo4j_driver, client=None):
        self.driver = neo4j_driver
        # Client is no longer used for local LLM calls, we will proxy to Node.js

    def detect_and_record(self, filename, document_content):
        """
        Runs AFTER the entire document has been processed into the graph.
        Finds identically named entities across different documents within the same SubModules to detect semantic shifts or contradictions.
        """
        if not self.driver:
            return

        print(f"  [ConflictDetector] Initiating global document conflict check for: {filename}")
        
        # 1. Retrieve all newly minted nodes in this document that share a SubModule with identically named nodes in older documents.
        potential_conflicts = []
        try:
            with self.driver.session() as session:
                result = session.run(
                    """
                    MATCH (d:Document {name: $current_doc})<-[:MENTIONED_IN]-(new_e:Entity)-[:BELONGS_TO]->(s:SubModule)<-[:BELONGS_TO]-(old_e:Entity)-[:MENTIONED_IN]->(old_d:Document)
                    WHERE old_d.name <> $current_doc 
                      AND new_e.name = old_e.name
                    RETURN new_e.name as entity_name, old_d.name as source_doc, s.name as sub_module
                    LIMIT 20
                    """,
                    current_doc=filename
                )
                potential_conflicts = [record.data() for record in result]
        except Exception as e:
            print(f"  [ConflictDetector] Neo4j Error during global scan: {e}")
            return

        if not potential_conflicts:
            print("  [ConflictDetector] No identically named overlapping entities found. Graph is clean.")
            return

        print(f"  [ConflictDetector] Found {len(potential_conflicts)} potential overlaps. Analyzing via Agent Microservice...")

        # 2. Call Node.js Microservice for smart conflict check
        for conflict in potential_conflicts:
            entity_name = conflict['entity_name']
            old_doc = conflict['source_doc']
            sub_mod = conflict['sub_module']
            print(f"  [ConflictDetector] Checking '{entity_name}' in {sub_mod} (against {old_doc})")
            
            try:
                # We send the entire document content context. The Node.js agent will filter internally using vector search if needed.
                payload = {
                    "new_requirement": entity_name,
                    "retrieved_context": document_content[:20000] # Cap to prevent huge payloads, trust Node RAG to supplement
                }
                res = requests.post("http://localhost:8002/api/analyze-conflict", json=payload, timeout=60)
                
                if res.status_code == 200:
                    data = res.json()
                    if data.get("conflict_detected"):
                        reason = data.get("reason", "Conflict detected by global evaluation.")
                        suggestion = data.get("suggestion", "")
                        new_ctx = data.get("new_context_snippet", entity_name)
                        old_ctx = data.get("old_context_snippet", entity_name)
                        
                        print(f"  [ConflictDetector] !!! CONTRADICTION FOUND for '{entity_name}' !!!")
                        print(f"  Reason: {reason}")
                        
                        # 3. Record in Graph
                        self._record_conflict(entity_name, entity_name, reason, suggestion, new_ctx, old_ctx, old_doc)
            except Exception as e:
                print(f"  [ConflictDetector] Error invoking microservice: {e}")

    def _record_conflict(self, new_name, old_name, reason, suggestion, new_context, old_context, old_source):
        try:
            with self.driver.session() as session:
                session.run(
                    """
                    MATCH (n:Entity {name: $new_name})
                    MATCH (o:Entity {name: $old_name})
                    MERGE (n)-[:CONTRADICTS {
                        reason: $reason, 
                        suggestion: $suggestion,
                        new_context: $new_context,
                        old_context: $old_context,
                        old_source: $old_source,
                        detected_at: datetime()
                    }]->(o)
                    """,
                    new_name=new_name, 
                    old_name=old_name, 
                    reason=reason,
                    suggestion=suggestion,
                    new_context=new_context,
                    old_context=old_context,
                    old_source=old_source
                )
        except Exception as e:
            print(f"  [ConflictDetector] Error performing graph write: {e}")
