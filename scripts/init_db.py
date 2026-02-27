import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from python_services.db import engine, Base, SessionLocal, Domain

def init_db():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    default_domain = db.query(Domain).filter(Domain.name == "票据业务").first()
    if not default_domain:
        print("Creating default domain: 票据业务")
        from uuid import uuid4
        db.add(Domain(id=str(uuid4()), name="票据业务", description="Default bills domain"))
        db.commit()
    db.close()
    print("DB initialized!")

if __name__ == "__main__":
    init_db()
