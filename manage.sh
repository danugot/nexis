#!/bin/bash

# Ensure we are in the project root
cd "$(dirname "$0")"

function start_all() {
    echo "Building and starting all Dockerized Nexis services..."
    echo "This will compile the latest local code from rag_api, worker, agent_api, and web-ui into containers."
    
    # Run the build and start in detached mode
    docker-compose up -d --build
    
    echo ""
    echo "========================================================"
    echo "All components have been built and started successfully!"
    echo " - Web UI:  http://localhost:5173"
    echo " - RAG API: http://localhost:8001"
    echo " - Neo4j:   http://localhost:7474"
    echo "========================================================"
}

function stop_all() {
    echo "Stopping all Dockerized Nexis services and networks..."
    docker-compose down
    echo "All services stopped."
}

function check_status() {
    echo "Checking Docker service status..."
    docker-compose ps
}

function logs_all() {
    echo "Tailing all container logs (Ctrl+C to exit)..."
    docker-compose logs -f
}

function restart_all() {
    stop_all
    echo "Waiting for 2 seconds before restarting..."
    sleep 2
    start_all
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
    logs)
        logs_all
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|status|logs}"
        exit 1
esac
