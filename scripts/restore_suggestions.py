from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
import os
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from python_services.db import TaxonomySuggestion, engine, SessionLocal

def restore_rejected():
    db = SessionLocal()
    rejected = db.query(TaxonomySuggestion).filter(TaxonomySuggestion.status == 'REJECTED').all()
    count = 0
    for sugg in rejected:
        sugg.status = 'PENDING'
        count += 1
    
    db.commit()
    print(f"Restored {count} REJECTED suggestions back to PENDING.")
    
    # Let's also create a dummy rejected one if there were none, just for testing
    if count == 0:
        import uuid
        sugg = TaxonomySuggestion(
            id="sugg_test_mock_123",
            domainId="test-domain-123",
            proposedPath="Module A / Submodule B / FineTuned Entity",
            status="PENDING",
            reasoning="Mock suggestion for testing fine-tune API."
        )
        db.add(sugg)
        db.commit()
        print("Created 1 mock PENDING suggestion since none were rejected.")

    pending = db.query(TaxonomySuggestion).filter(TaxonomySuggestion.status == 'PENDING').all()
    print(f"Total PENDING suggestions now: {len(pending)}")
    for p in pending[:5]:
        print(f" - [{p.id}] {p.proposedPath} (Domain: {p.domainId})")
        
    db.close()

if __name__ == '__main__':
    restore_rejected()
