# PRD: Requirements Agent - "Virtual BA" MVP (v1.0)

## 1. 项目愿景

构建一个基于 **Skill-Driven + Local-First** 架构的智能需求分析助理。它能够理解历史 PRD 语境，在对话中实时拦截逻辑冲突，并闭环完成文档改写。

## 2. 核心技术栈 (Tech Stack)

*   **引擎 (Orchestrator)**: [pi-coding-agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) (Node.js/TypeScript)
*   **开发环境**: Node.js (v20+), pnpm (包管理)
*   **逻辑驱动 (Core Logic)**: TypeScript Skills / Pi Extensions
*   **存储 (Storage)**:
    *   **知识库**: Local Markdown Files (RAG 基础)
    *   **向量库**: ChromaDB / LanceDB (Node.js bindings or via API)
    *   **关系图**: Neo4j (用于模块依赖分析)
*   **模型 (LLM)**: Gemini 3 Flash Preview (via Pi Model Provider)
*   **交互 (Interface)**: Pi CLI / Coding Agent TUI

---

## 3. 功能需求 (Functional Requirements)

### 3.1 知识预处理 (Knowledge Distillation)

* **Req-01**: 将 `knowledge/` 目录下的 Word/Markdown 文档转化为原子知识点。
* **Req-02**: 识别文档中的“硬约束”（如：数值范围、权限等级、前置条件），并自动生成对应的 **Validation Logic (TS)**。

### 3.2 实时冲突检测 (Real-time Conflict Detection)

* **Req-03**: 在 Chat Session 中，Agent 必须在生成回答前，强制检索向量库。
* **Req-04**: 如果用户输入涉及“数值、流程、角色”，Agent 必须触发对应的 **Validation Skill**。

### 3.3 文档自动改写 (Automated Document Rewriting)

* **Req-05**: 根据讨论达成的 `Decision`，Agent 需定位原始 Markdown 的特定 `Header` 块。
* **Req-06**: 采用 **Diff 模式** 修改：保留原意，插入变更记录，并维护版本号。

---

## 4. 模拟场景要求 (Simulation Scenario)

为了跑通流程，请 Antigravity 实现以下测试桩（Test Stub）：

* **场景数据**:
* `history_prd.md`: 规定“普通会员（Level 1-3）无提现权限，黄金会员（Level 4+）提现上限 5000”。


* **用户指令**: “我想让 Level 2 的用户可以提现 200 元试用，你觉得行吗？”
* **预期行为**:
1. Agent 检索历史文档，发现 Level 2 无权限。
2. Agent 运行 `withdraw_skill.py` 校验失败。
3. Agent 回复：“冲突提示：历史规定 Level 4 才能提现。若要开放 Level 2，需修改‘权限矩阵’。是否确认修改？”
4. 用户确认后，`history_prd.md` 自动更新。



---

## 5. 面向 Antigravity 的架构设计提示 (AI Implementation Prompts)

**请让 Antigravity 优先生成以下内容：**

1.  **`package.json`**: 定义项目依赖 (`@mariozechner/pi-coding-agent` 等)。
2.  **`pi-config.json`** (or equivalent): 配置 Agent 的 Model、Tools 和 Context。
3.  **`src/skills/conflict-checker.ts`**: 实现 TS 版本的逻辑冲突检测工具。
4.  **`src/index.ts`**: 启动脚本，初始化 Pi Agent 并挂载自定义 Skills。

---

## 6. 资深 PM 的加餐建议 (Advanced Features)

* **逻辑回溯 (Traceability)**: 要求生成的代码在输出建议时，必须包含 `[Source: history_prd.md#Line 24]` 这样的元数据标签。
* **原子化 Skill 模板**: 告诉 Antigravity，所有的 Skill 必须遵循统一的接口：`def execute(input: dict) -> dict`。