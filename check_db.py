import sys, os
PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from python_services.db import SessionLocal, Document
session = SessionLocal()
for doc in session.query(Document).all():
    print(f"ID: {doc.id}, File: {doc.filename}, Status: {doc.status}")
session.close()
