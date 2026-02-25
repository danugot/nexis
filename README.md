# Nexis v2.8 - Intelligent Enterprise RAG System

Nexis is an advanced Business Logic Verification System powered by Agentic AI, GraphRAG, and ReAct patterns.

## Architecture (Standardized)

The project is structured as a set of microservices:

| Service | Path | Description | Tech Stack |
| :--- | :--- | :--- | :--- |
| **Agent Brain** | `services/agent/` | The core ReAct Agent that reasons and executes tasks. | TypeScript, Node.js, Google GenAI |
| **RAG API** | `services/rag_api/` | Retrieval Augmented Generation Service (Vector + Graph). | Python, FastAPI, ChromaDB, Neo4j |
| **Ingestion Worker** | `services/worker/` | Asynchronous document processing and Knowledge Graph construction. | Python, Redis, Google GenAI (Extraction) |
| **Infrastructure** | `docker-compose.yml` | Orchestrates Redis, ChromaDB, Neo4j, and Python Services. | Docker Compose |

## Getting Started

### Prerequisites
- Docker & Docker Compose
- Node.js v18+ (for local Agent dev)
- Python 3.9+ (for local Service dev)

### Quick Start (Docker)

1.  **Configure Environment**:
    Ensure `.env` exists in the root directory with keys:
    ```bash
    GEMINI_API_KEY=...
    NEO4J_PASSWORD=nexis_password
    # ... other config ...
    ```

2.  **Launch Stack**:
    ```bash
    docker-compose up -d --build
    ```
    This starts:
    - **Neo4j** (Graph DB) on `localhost:7474` / `7687`
    - **ChromaDB** (Vector DB) on `localhost:8000`
    - **Redis** (Queue) on `localhost:6379`
    - **RAG API** on `localhost:8001`
    - **Worker** (Background Processing)

3.  **Run Agent (Interactive)**:
    Since the Agent is an interactive CLI, run it locally:
    ```bash
    cd services/agent
    npm install
    npm start
    ```

### Local Development (Recommended: `uv`)

This project uses `uv` for fast Python package management and environment isolation.

1.  **Install `uv`** (if not installed):
    ```bash
    curl -LsSf https://astral.sh/uv/install.sh | sh
    ```

2.  **Setup Environment**:
    ```bash
    # Create venv with Python 3.11 (Required for MarkItDown)
    uv venv .venv --python 3.11
    
    # Install dependencies
    uv pip install -r services/rag_api/requirements.txt -r services/worker/requirements.txt
    ```

3.  **Run Services**:
    You can use the helper script:
    ```bash
    ./start_services.sh
    ```
    
    Or run individually:
    ```bash
    # RAG API
    .venv/bin/python services/rag_api/main.py

    # Worker
    .venv/bin/python services/worker/main.py
    ```

## Features
- **Hybrid Retrieval**: Combines Vector Similarity with Knowledge Graph Traversal.
- **Auto-Ingestion**: Drop files into `raw_docs/` (or queue) -> Auto-processed by Worker.
- **ReAct Loop**: Agent actively retrieves context before answering constraints.
