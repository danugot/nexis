#!/bin/bash

# Ensure we are in the project root
cd "$(dirname "$0")"

# Set PYTHONPATH so services can find python_services module
export PYTHONPATH=$(pwd)

function start_all() {
    echo "Starting Infrastructure (Redis, Chroma, Neo4j, Postgres)..."
    docker-compose up -d redis chroma neo4j postgres
    sleep 3

    echo "Starting Python Services (RAG API and Worker)..."
    nohup .venv/bin/python -u services/rag_api/main.py > logs/rag_api.log 2>&1 &
    echo "  - RAG API running on port 8001. Logs: logs/rag_api.log"

    nohup .venv/bin/python -u services/worker/main.py > logs/worker.log 2>&1 &
    echo "  - Worker running. Logs: logs/worker.log"

    echo "Starting Node.js Agent API..."
    cd services/agent
    if [ ! -d "node_modules" ]; then
        echo "  - Installing Agent dependencies..."
        npm install
    fi
    nohup npx ts-node src/server.ts > ../../logs/agent_api.log 2>&1 &
    echo "  - Agent API running on port 8002. Logs: logs/agent_api.log"
    cd ../..

    echo "Starting Frontend Web UI..."
    cd web-ui
    if [ ! -d "node_modules" ]; then
        echo "  - Installing frontend dependencies..."
        npm install -g pnpm || true
        pnpm install
    fi
    nohup pnpm run dev -- --port 5173 --strictPort > ../logs/web_ui.log 2>&1 &
    echo "  - Web UI started (Port 5173). Logs: logs/web_ui.log"
    cd ..

    echo "========================================================"
    echo "All components have been started!"
    echo "========================================================"
}

function stop_all() {
    echo "Stopping any existing local services..."
    lsof -ti:5173,5174,8001,8002 | xargs kill -9 2>/dev/null || true
    pkill -f "uvicorn" || true
    pkill -f "services/rag_api/main.py" || true
    pkill -f "services/worker/main.py" || true
    pkill -f "src/server.ts" || true
    pkill -f "ts-node" || true
    pkill -f "vite" || true
    docker-compose down
    echo "All services stopped."
}

function restart_all() {
    stop_all
    sleep 2
    start_all
}

function check_status() {
    echo "Checking service status..."
    docker-compose ps
    echo "---"
    pgrep -lf "services/rag_api/main.py" || echo "RAG API: STOPPED"
    pgrep -lf "services/worker/main.py" || echo "Worker: STOPPED"
    pgrep -lf "src/server.ts" || echo "Agent API: STOPPED"
    pgrep -lf "vite" || echo "Web UI: STOPPED"
}

case "$1" in
    start)
        start_all
        ;;
    stop)
        stop_all
        ;;
    restart)
        restart_all
        ;;
    status)
        check_status
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|status}"
        exit 1
esac
