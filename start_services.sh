#!/bin/bash

# 1. Start Infrastructure (Docker)
echo "Starting Infrastructure (Redis, Chroma, Neo4j)..."
docker-compose up -d redis chroma neo4j

# Set PYTHONPATH so services can find python_services module
export PYTHONPATH=$(pwd)

# 2. Start Services (Python)
echo "Starting RAG API (Port 8001)..."
nohup .venv/bin/python -u services/rag_api/main.py > rag_api.log 2>&1 &
RAG_PID=$!
echo "RAG API running (PID: $RAG_PID). Logs: rag_api.log"

echo "Starting Worker..."
nohup .venv/bin/python -u services/worker/main.py > worker.log 2>&1 &
WORKER_PID=$!
echo "Worker running (PID: $WORKER_PID). Logs: worker.log"

echo "Services are up!"
echo "Use 'tail -f worker.log' to monitor ingestion."
echo "Press Ctrl+C to stop."

trap "kill $RAG_PID $WORKER_PID; exit" SIGINT SIGTERM

wait
