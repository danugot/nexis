#!/bin/bash

# Kill any existing local services
echo "Stopping any existing local services..."
# Aggressively free up standard ports to avoid silent port shifting (like Vite starting on 5174)
lsof -ti:5173,5174,8001,8002 | xargs kill -9 2>/dev/null || true
pkill -f "uvicorn" || true
pkill -f "services/rag_api/main.py" || true
pkill -f "services/worker/main.py" || true
pkill -f "services/agent/src/server.ts" || true
pkill -f "ts-node" || true
pkill -f "vite" || true

# 1. Start Infrastructure (Docker)
echo "Starting Infrastructure (Redis, Chroma, Neo4j)..."
docker-compose up -d redis chroma neo4j

# Wait a few seconds for databases to be ready
sleep 3

# Set PYTHONPATH so services can find python_services module
export PYTHONPATH=$(pwd)

# 2. Start Backend APIs (Python)
echo "Starting Python Services (RAG API and Worker)..."
nohup .venv/bin/python -u services/rag_api/main.py > rag_api.log 2>&1 &
echo "  - RAG API running on port 8001. Logs: rag_api.log"

nohup .venv/bin/python -u services/worker/main.py > worker.log 2>&1 &
echo "  - Worker running. Logs: worker.log"



# 3. Start Node.js Agent API (ReAct Server)
echo "Starting Node.js Agent API (ReAct) server..."
cd services/agent
if [ ! -d "node_modules" ]; then
    echo "  - Installing Agent dependencies..."
    npm install
fi
nohup npx ts-node src/server.ts > ../../agent_api.log 2>&1 &
echo "  - Agent API running on port 8002. Logs: agent_api.log"
cd ../..

# 4. Start Frontend Web UI (Node/Vite)
echo "Starting Frontend Web UI..."
cd web-ui
# Ensure dependencies are installed
if [ ! -d "node_modules" ]; then
    echo "  - Installing frontend dependencies..."
    npm install -g pnpm || true
    pnpm install
fi

nohup pnpm run dev -- --port 5173 --strictPort > ../web_ui.log 2>&1 &
echo "  - Web UI started (Port 5173). Logs: web_ui.log"
cd ..

echo ""
echo "========================================================"
echo "All components have been started! (Databases via Docker, Apps Native)"
echo "========================================================"
echo "Endpoints:"
echo "  - Web UI : http://localhost:5173"
echo "  - RAG API: http://localhost:8001"
echo "  - Neo4j  : http://localhost:7474 (Username: neo4j, Password: nexis_password)"
echo "  - Chroma : http://localhost:8000"
echo "========================================================"
echo "Commands for monitoring logs:"
echo "  - Web UI Logs  : tail -f web_ui.log"
echo "  - RAG API Logs : tail -f rag_api.log"
echo "  - Agent API    : tail -f agent_api.log"
echo "  - Worker Logs  : tail -f worker.log"
echo "  - DB Logs      : docker-compose logs -f"
echo "========================================================"
echo "To STOP everything, run:"
echo "  pkill -f \"vite\" && pkill -f \"ts-node\" && pkill -f \"main.py\" && docker-compose down"
echo "========================================================"
