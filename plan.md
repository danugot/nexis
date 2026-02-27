# Nexis System - Future Development Plan (Epics)

Based on the architectural progress (Claw paradigm, Knowledge Graph extraction, Dual-track RAG), the following four high-priority Epic directions have been identified for the next phase of evolution:

## 🛡️ Direction 1: The Knowledge Graph Explorer (图谱可视化与交互引擎)
Currently, Neo4j extracts rich entities (UI_MODULE, CONCEPT, FINANCING_PATH_TYPE) and relationships (MENTIONED_IN, BELONGS_TO) that operate passively in the backend.
- **Interactive Graph Canvas**: Introduce a library like `react-force-graph` in the frontend. When searching for `@Project`, dynamically render the entire business concept topology alongside the chat.
- **Progressive Exploration (1-hop expansion)**: Support clicking `<+>` on nodes to expand relationships step-by-step, preventing visual overload.
- **Human-in-the-loop Correction**: Allow users to manually draw edges or delete incorrect relationships directly on the canvas.
- **Value**: Provides a highly futuristic "Second Brain" interface, allowing non-technical stakeholders to intuitively grasp the system's business logic architecture.

## 🧠 Direction 2: Proactive Agent (主动工作的数字精灵)
Transitioning Nexis from a reactive Q&A bot to a proactive background thinker (Andrej Karpathy's 3-Layer Agent model).
- **Automated Conflict Analysis**: Upon uploading a new version of a PRD (e.g., V1.2), the Nexis Worker automatically cross-references and runs conflict detection against the historical V1.0 graph. Upon completion, it proactively pushes a "Potential Business Logic Conflict Report" notification to the user.
- **PRD Assistant Generation**: Add a "Drafting Mode." Users input a plain-text prompt (e.g., "Add a whitelist control to this page"), and Nexis retrieves its graph awareness of the current page structure to output a standardized, logically-closed PRD requirement block.

## 👁️ Direction 3: Multimodal Ingestion (多模态解析：图表与复杂表格)
Enterprise PRDs contain complex screenshots, flowcharts, and merged layout tables which current Markdown parsers miss.
- **VLM Pipeline Integration**: Utilize Vision Large Models (like Qwen-VL). When encountering images or state-machine diagrams in Word/PDFs, the system delegates them to the VLM to translate into detailed Markdown descriptions before generating vector embeddings.
- **Value**: Eliminates the blind spots associated with interpreting crucial workflows (e.g., "State Transition Diagrams", "System Interaction Sequence Diagrams") that are typically embedded as images.

## 📚 Direction 4: Versioning & Diffs (版本控制与知识溯源)
Knowledge in PRDs is highly iterative and frequently deprecated.
- **Knowledge Lifecycle & Deprecation**: Implement mechanics to gracefully handle old vs. new document versions, ensuring V1.1 knowledge actively overwrites or deprecates V1.0 knowledge in the RAG retrieval pipeline without creating self-contradictory hallucinations.
- **Precision Citation Highlighting**: When the Chat replies with `[Source: XXX.docx]`, users can open a split right-panel PDF/Word viewer that automatically scrolls to and highlights the exact originating paragraph or page. "Every word is grounded."
