import os
import redis
import json
import sys

PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))
if PROJECT_ROOT not in sys.path:
    sys.path.insert(0, PROJECT_ROOT)

from python_services.db import SessionLocal, Document

redis_client = redis.Redis(host='localhost', port=6380, db=0)

def requeue_document(filename):
    session = SessionLocal()
    doc = session.query(Document).filter_by(filename=filename).order_by(Document.createdAt.desc()).first()
    session.close()

    if not doc:
        print(f"Could not find {filename} in Postgres.")
        return

    doc_id = str(doc.id)
    
    payload = json.dumps({
        "documentId": doc_id,
        "filename": filename,
        "filePath": f"raw_docs/{filename}"
    })
    
    redis_client.lpush("nexis:ingest:queue", payload)
    print(f"Queued {filename} (ID: {doc_id}) to Redis.")

if __name__ == "__main__":
    requeue_document("【产品需求规格说明书】新一代票据20220706.docx")
