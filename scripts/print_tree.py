import sys
import os
sys.path.append(os.getcwd())
try:
    from python_services.db import SessionLocal, TaxonomyNode
    db = SessionLocal()
    nodes = db.query(TaxonomyNode).all()
    
    # Build tree
    tree = {}
    for n in nodes:
        tree[n.id] = {"name": n.name, "level": n.level, "parent": n.parentId, "children": []}
    
    roots = []
    for pid, data in tree.items():
        if data["parent"] and data["parent"] in tree:
            tree[data["parent"]]["children"].append(pid)
        else:
            roots.append(pid)
            
    def print_tree(node_id, indent=""):
        node = tree[node_id]
        print(f"{indent}- {node['name']} ({node['level']})")
        for child_id in node["children"]:
            print_tree(child_id, indent + "  ")

    print("\n--- Taxonomy Tree ---")
    for r in roots:
        print_tree(r)

except Exception as e:
    print(f"Error querying DB: {e}")
