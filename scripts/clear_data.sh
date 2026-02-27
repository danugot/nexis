#!/bin/bash

echo "🚀 Starting data clear process inside Docker network..."

docker run --rm --network nexis_default \
  -v $(pwd)/scripts:/app/scripts \
  -e DATABASE_URL="postgresql://postgres:nexis_postgres@postgres:5432/nexis_chat" \
  -e NEO4J_URI="bolt://neo4j:7687" \
  -e NEO4J_USER="neo4j" \
  -e NEO4J_PASSWORD="nexis_password" \
  -e CHROMA_HOST="chroma" \
  -e CHROMA_PORT="8000" \
  -e REDIS_URL="redis://redis:6379/0" \
  nexis-rag_api python /app/scripts/clear_data.py

echo "✅ Data wipe finished."
