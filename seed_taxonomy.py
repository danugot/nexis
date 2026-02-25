import os
import sys
import yaml
from uuid import uuid4

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from python_services.db import SessionLocal, Domain, TaxonomyNode

def seed_taxonomy():
    db = SessionLocal()
    seed_path = os.path.join(os.path.dirname(__file__), 'services', 'worker', 'taxonomy_seed.yaml')
    
    if not os.path.exists(seed_path):
        print(f"Seed file not found at {seed_path}")
        return

    with open(seed_path, 'r', encoding='utf-8') as f:
        data = yaml.safe_load(f)

    for item in data:
        domain_name = item.get('Domain')
        if not domain_name:
            continue
            
        print(f"Processing Domain: {domain_name}")
        domain = db.query(Domain).filter(Domain.name == domain_name).first()
        if not domain:
            domain = Domain(id=str(uuid4()), name=domain_name, description=f"Imported from seed")
            db.add(domain)
            db.commit()
            print(f"  -> Created new Domain ID: {domain.id}")

        modules = item.get('Modules', [])
        for mod_dict in modules:
            # modules is a list of dicts: {'ModuleName': {'SubModules': [...]}} OR {'概览': None, 'SubModules': [...]} wait yaml is:
            # - ModuleName 
            #   SubModules:
            #     - SubMod1: [...]
            # actually looking at the yaml the keys are the module names, but let's parse it safely
            for mod_name, mod_content in mod_dict.items():
                if mod_name == 'SubModules': continue # safety
                
                print(f"  Processing Module: {mod_name}")
                mod_node = db.query(TaxonomyNode).filter(TaxonomyNode.domainId == domain.id, TaxonomyNode.name == mod_name, TaxonomyNode.level == 'MODULE').first()
                if not mod_node:
                    mod_node = TaxonomyNode(id=str(uuid4()), domainId=domain.id, name=mod_name, level='MODULE')
                    db.add(mod_node)
                    db.commit()

                # it seems mod_dict has 'SubModules' at the same level as mod_name occasionally in bad yaml, but let's check mod_content
                # Actually, the YAML is:
                # - 概览
                #   SubModules:
                submodules_data = mod_content.get('SubModules', []) if isinstance(mod_content, dict) else []
                # wait, the YAML structure is:
                # Modules:
                #   - 概览               <- string? no, it's a dict. wait no, looking at the YAML:
                # Modules:
                #   - 概览
                #     SubModules:
                #       - 待办事项: [代办, 业务量统计]
                
    db.close()

# Rewriting parsing logic to exactly match the YAML provided:
def robust_seed():
    db = SessionLocal()
    seed_path = os.path.join(os.path.dirname(__file__), 'services', 'worker', 'taxonomy_seed.yaml')
    
    with open(seed_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    current_domain = None
    current_module = None

    for line in lines:
        lineStr = line.rstrip()
        if not lineStr.strip() or lineStr.strip().startswith('#'): continue

        if lineStr.startswith('- Domain:'):
            domain_name = lineStr.split('Domain:')[1].strip()
            domain = db.query(Domain).filter(Domain.name == domain_name).first()
            if not domain:
                domain = Domain(id=str(uuid4()), name=domain_name, description="Imported Domain")
                db.add(domain)
                db.commit()
            current_domain = domain
            current_module = None
        
        elif lineStr.startswith('    - ') and 'SubModules:' not in lineStr:
            # We are setting a module
            if current_domain:
                mod_name = lineStr.split('-')[1].strip()
                mod_node = db.query(TaxonomyNode).filter(TaxonomyNode.domainId == current_domain.id, TaxonomyNode.name == mod_name, TaxonomyNode.level == 'MODULE').first()
                if not mod_node:
                    mod_node = TaxonomyNode(id=str(uuid4()), domainId=current_domain.id, name=mod_name, level='MODULE')
                    db.add(mod_node)
                    db.commit()
                current_module = mod_node
                
        elif lineStr.startswith('        - ') and current_domain and current_module:
            # Submodule line like "        - 待办事项: [代办, 业务量统计]"
            sub_raw = lineStr.split('-')[1].strip()
            sub_name = sub_raw.split(':')[0].strip() if ':' in sub_raw else sub_raw
            
            sub_node = db.query(TaxonomyNode).filter(TaxonomyNode.domainId == current_domain.id, TaxonomyNode.name == sub_name, TaxonomyNode.level == 'SUBMODULE', TaxonomyNode.parentId == current_module.id).first()
            if not sub_node:
                sub_node = TaxonomyNode(id=str(uuid4()), domainId=current_domain.id, name=sub_name, level='SUBMODULE', parentId=current_module.id)
                db.add(sub_node)
                db.commit()

    db.close()
    print("Parsing and Seeding complete!")

if __name__ == "__main__":
    robust_seed()
