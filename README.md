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
graph TD
    User((User & Documents)) <--> UI[Web UI - React/Vite]
    UI <--> Agent[Agent Brain - Node.js/ReAct]
    
    subgraph "🤖 Intelligence Layer (Agent Skills)"
        Agent <--> Skills[Skill Dispatcher]
        
        subgraph "1. Architect Audit Core"
            S1_1[analyze-requirement]
            S1_2[check-compliance]
            S1_3[simulate-impact]
            S1_4[trace-dependencies]
            S1_5[detect-gaps]
        end
        
        subgraph "2. Generative Action"
            S2_1[draft-prd]
            S2_2[generate-tests]
            S2_3[withdraw-skill]
        end

        subgraph "3. Retrieval & Analysis"
            S3_1[retrieve-knowledge]
            S3_2[compare-requirements]
            S3_3[conflict-checker]
            S3_4[explain-lineage]
            S3_5[update-knowledge]
        end

        subgraph "4. Ingestion & Graph Building"
            S4_1[ingest-write-subgraph]
            S4_2[get-document-content]
            S4_3[ingest-get-taxonomy]
            S4_4[ingest-propose-category]
            S4_5[review-taxonomy-queue]
        end

        Skills --> S1_1
        Skills --> S2_1
        Skills --> S3_1
        Skills --> S4_1
    end
    
    subgraph "🗄️ Knowledge Infra (FastAPI & DBs)"
        RAG_API[Python RAG Service]
        RAG_API <--> Vector[(ChromaDB - Vectors)]
        RAG_API <--> Graph[(Neo4j - Knowledge Graph)]
        RAG_API <--> DB[(PostgreSQL - History/Meta)]
    end
    
    %% Connections between Skills and Infra
    S1_1 & S1_2 & S1_3 & S1_4 & S1_5 -.- RAG_API
    S3_1 & S3_2 & S3_3 & S3_4 & S3_5 -.- RAG_API
    S4_1 & S4_2 & S4_3 & S4_4 & S4_5 -.- RAG_API
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
Q: "What are the core processes for ticketing?"
> The assistant uses Neo4j to follow `NEXT_STEP` relationships, outlining the complete path from ticketing registration to receipt.

### 2. Requirement Simulation
Q: "If we support initiating acceptance and collection simultaneously after registration, can this be realized?"
> The assistant triggers the `simulate_impact` skill to tell you if the change breaks existing compliance rules.

### 3. Automated Drafting
Q: "Draft a PRD for that proposal."
> The assistant writes a professional Markdown PRD based on the identified impacts and logic changes.

---

## ⚖️ 许可证

本项目基于 MIT 协议开源。
