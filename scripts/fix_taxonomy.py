import os
import sys
from uuid import uuid4
from sqlalchemy import text

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from python_services.db import SessionLocal, Domain, TaxonomyNode

def fix_taxonomy():
    db = SessionLocal()
    
    # 0. Fix missing column from Schema Evolution
    try:
        db.execute(text('ALTER TABLE "Document" ADD COLUMN "domainId" VARCHAR(255);'))
        db.commit()
        print("Migrated Document table: Added domainId column.")
    except Exception as e:
        db.rollback()
        print("Column domainId likely already exists or other error (ignored)")

    # 1. Clean up mistakenly created domains
    to_delete = ['票据业务', '票据融资', '票据']
    for name in to_delete:
        d = db.query(Domain).filter(Domain.name == name).first()
        if d:
            db.query(TaxonomyNode).filter(TaxonomyNode.domainId == d.id).delete()
            db.delete(d)
    db.commit()

    # 2. Create the unified "票据" Domain
    domain = Domain(id=str(uuid4()), name="票据", description="Unified Bills & Financing Domain")
    db.add(domain)
    db.commit()
    print(f"Created Unified Domain: {domain.name} ({domain.id})")

    # 3. Parse the seed yaml and shove everything under this one domain
    seed_path = os.path.join(os.path.dirname(__file__), 'services', 'worker', 'taxonomy_seed.yaml')
    with open(seed_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    current_module = None

    for line in lines:
        lineStr = line.rstrip()
        if not lineStr.strip() or lineStr.strip().startswith('#'): continue

        if lineStr.startswith('- Domain:'):
            # Ignore the domain split in the yaml. Reset module context.
            current_module = None
            continue
        
        elif lineStr.startswith('    - ') and 'SubModules:' not in lineStr:
            mod_name = lineStr.split('-')[1].strip()
            
            # Sub-domain prefix handling (optional but good idea if names conflict, but they don't here)
            mod_node = db.query(TaxonomyNode).filter(TaxonomyNode.domainId == domain.id, TaxonomyNode.name == mod_name, TaxonomyNode.level == 'MODULE').first()
            if not mod_node:
                mod_node = TaxonomyNode(id=str(uuid4()), domainId=domain.id, name=mod_name, level='MODULE')
                db.add(mod_node)
                db.commit()
                print(f"  Added Module: {mod_name}")
            current_module = mod_node
                
        elif lineStr.startswith('        - ') and current_module:
            sub_raw = lineStr.split('-')[1].strip()
            sub_name = sub_raw.split(':')[0].strip() if ':' in sub_raw else sub_raw
            
            sub_node = db.query(TaxonomyNode).filter(TaxonomyNode.domainId == domain.id, TaxonomyNode.name == sub_name, TaxonomyNode.level == 'SUBMODULE', TaxonomyNode.parentId == current_module.id).first()
            if not sub_node:
                sub_node = TaxonomyNode(id=str(uuid4()), domainId=domain.id, name=sub_name, level='SUBMODULE', parentId=current_module.id)
                db.add(sub_node)
                db.commit()
                print(f"    Added SubModule: {sub_name}")

    db.close()
    print("Database has been correctly seeded into the single '票据' Domain.")

if __name__ == "__main__":
    fix_taxonomy()
