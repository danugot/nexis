#!/bin/bash

# Ensure we are in the project root
cd "$(dirname "$0")"

echo "Initializing Agent..."

# Install dependencies if needed
if [ ! -d "services/agent/node_modules" ]; then
    echo "Installing Agent dependencies..."
    cd services/agent
    npm install
    cd ../..
fi

# Start the Agent
echo "Starting Agent CLI..."
cd services/agent
npm start
