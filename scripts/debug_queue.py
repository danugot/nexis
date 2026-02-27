
import redis
import json
import os

r = redis.Redis(host='localhost', port=6379, db=0)

queue_name = 'nexis:ingest:queue'
length = r.llen(queue_name)
print(f"Queue Length: {length}")

if length > 0:
    items = r.lrange(queue_name, 0, -1)
    for item in items:
        print(f"Item: {item}")

# Force push if needed
r.rpush(queue_name, json.dumps({"filePath": os.path.abspath("raw_docs/test_graph.docx")}))
print("Force pushed test_graph.docx to queue")
