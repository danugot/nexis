# Nexis (Next-Gen Intelligent System)

English | [中文](./README.zh-CN.md)

---

> **Nexis is an enterprise-grade knowledge lifecycle management system powered by Graph-Augmented Retrieval (GraphRAG), Agentic Workflows, and Architectural Impact Simulation.**

Nexis is more than just a RAG (Retrieval-Augmented Generation) tool; it’s a "Business Architect's Assistant." It extracts complex business logic from hundreds of PRD documents, builds a structured knowledge graph, and allows users to simulate the impact of new requirements in a "Virtual Sandbox."

---

## 🚀 Key Features

- **Graph-RAG Dual-Engine Retrieval**: Combines semantic matching (ChromaDB) with multi-hop logical association (Neo4j) to precisely recover business chains across documents.
- **Architectural Sandbox (Simulate Impact)**: Automatically analyzes the feasibility of new requirement proposals, predicts impacts on existing modules, and identifies potential logical conflicts (Broken Rules).
- **Automated PRD Drafting (Draft PRD)**: Generates standardized PRDs based on simulation results with one click, providing professional Markdown formatting.
- **Automated Taxonomy Consolidation**: Built-in Map-Reduce logic to automatically merge redundant taxonomy suggestions, keeping the knowledge base clean and structured.
- **Hybrid Model Strategy**: Deeply optimized for Alibaba Qwen `text-embedding-v3` for high-precision Chinese vectorization, supporting large-scale reasoning and "Thought" models.

---

## 🏗️ System Architecture

```mermaid
flowchart TB
    %% Colors and Styles
    classDef client fill:#7c3aed,stroke:#5b21b6,stroke-width:2px,color:#fff
    classDef system fill:#2563eb,stroke:#1d4ed8,stroke-width:2px,color:#fff
    classDef agent fill:#059669,stroke:#047857,stroke-width:2px,color:#fff
    classDef skill fill:#ffffff,stroke:#cbd5e1,stroke-width:1px,color:#1e293b,text-align:left
    classDef backend fill:#d97706,stroke:#b45309,stroke-width:2px,color:#fff
    classDef storage fill:#dc2626,stroke:#b91c1c,stroke-width:2px,color:#fff

    User(("👤 Users & Documents")):::client
    UI["💻 Web Interface (React / Vite)"]:::system

    subgraph AgentLayer ["🧠 Orchestration Layer (Agent Brain)"]
        direction TB
        Brain["🤖 Core Engine (Node.js/ReAct)"]:::agent
        Dispatcher{"⚙️ Skill Dispatcher"}:::agent
        Brain <--> Dispatcher
    end

    subgraph SkillsLayer ["🛠️ Intelligence Layer (Skills Ecosystem)"]
        direction LR
        S_Audit["<b>🏗️ 1. Architect Audit Core</b><br/>━━━━━━━━━━━━━━━━━━━━━━━<br/>🔹 analyze-requirement<br/>🔹 check-compliance<br/>🔹 simulate-impact<br/>🔹 trace-dependencies<br/>🔹 detect-gaps"]:::skill
        
        S_Gen["<b>✨ 2. Generative Action</b><br/>━━━━━━━━━━━━━━━━━━━<br/>🔸 draft-prd<br/>🔸 generate-tests<br/>🔸 withdraw-skill"]:::skill
        
        S_Anal["<b>🔍 3. Retrieval & Analysis</b><br/>━━━━━━━━━━━━━━━━━━━━<br/>🔎 retrieve-knowledge<br/>🔎 compare-requirements<br/>🔎 conflict-checker<br/>🔎 explain-lineage<br/>🔎 update-knowledge"]:::skill
        
        S_Ingest["<b>📦 4. Ingestion & Graph Building</b><br/>━━━━━━━━━━━━━━━━━━━━━━━<br/>📚 ingest-write-subgraph<br/>📚 get-document-content<br/>📚 ingest-get-taxonomy<br/>📚 ingest-propose-category<br/>📚 review-taxonomy-queue"]:::skill
    end

    subgraph InfraLayer ["🗄️ Knowledge Infrastructure Layer"]
        direction TB
        RAG["⚡ RAG Service API (Python / FastAPI)"]:::backend
        
        subgraph DBs [" "]
            direction LR
            VDB[("📊 ChromaDB<br/>(Vectors)")]:::storage
            GDB[("🕸️ Neo4j<br/>(Graph)")]:::storage
            RDB[("🗃️ PostgreSQL<br/>(History/Meta)")]:::storage
        end
        RAG <--> VDB
        RAG <--> GDB
        RAG <--> RDB
    end

    %% Flow Definitions
    User <-->|Interacts| UI
    UI <-->|HTTP / WS| Brain
    
    Dispatcher ===>|Routes to| S_Audit
    Dispatcher ===>|Routes to| S_Gen
    Dispatcher ===>|Routes to| S_Anal
    Dispatcher ===>|Routes to| S_Ingest

    S_Audit -.->|Verify Rules| RAG
    S_Gen -.->|Produce Content| RAG
    S_Anal -.->|Search Data| RAG
    S_Ingest -.->|Write Graph| RAG

    %% Custom Subgraph Styles
    style AgentLayer fill:#f0fdf4,stroke:#86efac,stroke-width:2px,stroke-dasharray: 4
    style SkillsLayer fill:#f8fafc,stroke:#e2e8f0,stroke-width:2px,stroke-dasharray: 4
    style InfraLayer fill:#fffbeb,stroke:#fde68a,stroke-width:2px,stroke-dasharray: 4
    style DBs fill:transparent,stroke:none
```

---

## 🛠️ Tech Stack

| Module | Tech Stack |
| :--- | :--- |
| **Frontend (Web UI)** | React 19, Vite, TailwindCSS, Shadcn UI, Lucide Icons |
| **Agent Brain** | Node.js, TypeScript, AI SDK / ReAct Pattern |
| **Backend API (RAG)** | Python 3.10+, FastAPI, SQLAlchemy |
| **Vector Database** | ChromaDB (with Dashscope `text-embedding-v3`) |
| **Graph Database** | Neo4j 5.x |
| **Persistence & Cache** | PostgreSQL 15, Redis 7.0 |

---

## 📦 Quick Start

### 1. Configure Environment
Create a `.env` file in the root directory and add your API keys:
```env
GEMINI_API_KEY=your_gemini_key
DASHSCOPE_API_KEY=your_qwen_key
NEO4J_PASSWORD=nexis_password
```

### 2. Launch with One Command
We provide a convenient script for full deployment:
```bash
./manage.sh start
```
This command automatically builds and starts all Docker containers (Postgres, Redis, Neo4j, Chroma, RAG API, Agent, Web UI).

### 3. Access the System
- **Web UI**: [http://localhost:5173](http://localhost:5173)
- **Admin Dashboard**: [http://localhost:5173/admin](http://localhost:5173/admin)
- **Graph Explorer**: [http://localhost:5173/graph](http://localhost:5173/graph)

---

## 📖 Core Skill Scenarios

### 1. Business Process Retrieval
Q: "What are the core steps in the order fulfillment process?"
> The assistant uses Neo4j to follow `NEXT_STEP` relationships, outlining the complete path from order creation to final delivery.

### 2. Requirement Simulation
Q: "If we allow concurrent state processing at node B, will it cause any conflicts?"
> The assistant triggers the `simulate_impact` skill to analyze the knowledge graph, identifying downstream dependencies and warning you if this breaks any existing compliance or data consistency rules.

### 3. Automated Drafting
Q: "Draft a PRD for the concurrent processing proposal."
> The assistant writes a professional Markdown PRD based on the identified impacts and logic changes, ensuring all edge cases from the simulation are documented.

---

## ⚖️ 许可证

本项目基于 MIT 协议开源。
