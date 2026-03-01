import redis
import json
import psycopg2
import sys

# Connect to Postgres container
try:
    conn = psycopg2.connect(
        dbname="nexis_chat",
        user="postgres",
        password="nexis_postgres",
        host="localhost",
        port=5433
    )
    cursor = conn.cursor()
    
    # 1. Find the archived document
    cursor.execute('SELECT id, filename, "projectName", "domainId" FROM "Document" WHERE status = %s;', ('ARCHIVED',))
    row = cursor.fetchone()
    if not row:
        print("No ARCHIVED documents found.")
        sys.exit(0)
        
    doc_id, filename, project_name, domain_id = row
    
    # 2. Update status to QUEUED
    cursor.execute('UPDATE "Document" SET status = %s WHERE id = %s;', ('QUEUED', doc_id))
    conn.commit()
    print(f"Document {filename} status restored to QUEUED. (ID: {doc_id})")
    
    cursor.close()
    conn.close()
except Exception as e:
    print(f"Database error: {e}")
    sys.exit(1)

# Push to Redis to trigger re-ingestion
try:
    r = redis.Redis(host='localhost', port=6380, decode_responses=True)
    job = {
        "type": "ingest",
        "filePath": f"/app/raw_docs/{filename}",
        "filename": filename,
        "projectName": project_name,
        "documentId": str(doc_id)
    }
    r.rpush("nexis:ingest:queue", json.dumps(job))
    print(f"Successfully pushed job to Redis for {filename}. The worker will now re-ingest it using text-embedding-v4.")
except Exception as e:
    print(f"Redis error: {e}")
    sys.exit(1)
