import sys
import os
sys.path.append(os.getcwd())
try:
    from python_services.db import SessionLocal, TaxonomySuggestion, TaxonomyNode
    db = SessionLocal()
    suggs = db.query(TaxonomySuggestion).order_by(TaxonomySuggestion.createdAt.desc()).limit(5).all()
    print("--- Suggestions ---")
    for s in suggs: 
        print(f"{s.id} | {s.proposedPath} | {s.reasoning[:50]} | {s.status}")

    nodes = db.query(TaxonomyNode).all()
    print("\n--- Nodes ---")
    for n in nodes: 
        print(f"{n.id} | {n.name} | {n.level} | Parent: {n.parentId}")
except Exception as e:
    print(f"Error querying DB: {e}")
