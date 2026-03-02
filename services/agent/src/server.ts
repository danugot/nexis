import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env from project root if not found locally
const rootEnvPath = path.resolve(__dirname, '../../../.env');
dotenv.config({ path: rootEnvPath });
dotenv.config(); // Fallback to default

import express from 'express';
import cors from 'cors';
import { GoogleGenerativeAI, FunctionDeclaration, SchemaType } from '@google/generative-ai';
import OpenAI from 'openai';
import Redis from 'ioredis';
import * as fs from 'fs';
import { checkConflict } from './skills/conflict-checker';
import { withdrawSkill } from './skills/withdraw-skill';
import { retrieveKnowledge } from './skills/retrieve-knowledge';
import { updateKnowledge } from './skills/update-knowledge';
import { getTaxonomyDeclaration, getTaxonomy } from './skills/ingest-get-taxonomy';
import { proposeNewCategoryDeclaration, proposeNewCategory } from './skills/ingest-propose-category';
import { writeSubgraphDeclaration, writeSubgraph } from './skills/ingest-write-subgraph';
import { reviewTaxonomyQueueDeclaration, reviewTaxonomyQueue } from './skills/review-taxonomy-queue';
import { simulateImpactDeclaration, simulateImpact } from './skills/simulate-impact';
import { draftPrdDeclaration, draftPrd } from './skills/draft-prd';
import { compareRequirementsDeclaration, compareRequirements } from './skills/compare-requirements';
import { traceDependenciesDeclaration, traceDependencies } from './skills/trace-dependencies';
import { prisma } from './db';

// --- Configuration ---
const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
    console.error('Error: GEMINI_API_KEY is not set in environment variables.');
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(API_KEY);
const openai = new OpenAI({
    apiKey: process.env.DASHSCOPE_API_KEY || process.env.OPENAI_API_KEY || "dummy-key-to-prevent-boot-crash",
    baseURL: process.env.OPENAI_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1"
});

const KNOWLEDGE_PATH = path.join(process.cwd(), 'knowledge', 'history_prd.md');

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6380');

function loadKnowledge(): string {
    if (fs.existsSync(KNOWLEDGE_PATH)) {
        return fs.readFileSync(KNOWLEDGE_PATH, 'utf-8');
    }
    return "";
}

// --- Tool Definitions (Schema) ---
const tools: FunctionDeclaration[] = [
    {
        name: "retrieve_knowledge",
        description: "Searches the Knowledge Base (Hybrid Vector + Graph) for relevant facts, rules, and history. ALWAYS call this first when handling a user request involving domain rules.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                query: {
                    type: SchemaType.STRING,
                    description: "The search query (e.g., 'Gold Member withdrawal limit')."
                }
            },
            required: ["query"]
        }
    },
    {
        name: "check_conflict",
        description: "Simulation Tool: Checks if a new requirement conflicts with the gathered context. Use this AFTER retrieving knowledge.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                new_requirement: {
                    type: SchemaType.STRING,
                    description: "The user's proposed requirement."
                },
                retrieved_context: {
                    type: SchemaType.STRING,
                    description: "The context you found via retrieve_knowledge."
                }
            },
            required: ["new_requirement", "retrieved_context"]
        }
    },
    {
        name: "withdraw_skill",
        description: "Validates if a user can withdraw a specific amount based on their level.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                user_level: {
                    type: SchemaType.NUMBER,
                    description: "The user's numeric level (e.g., 2)."
                },
                amount: {
                    type: SchemaType.NUMBER,
                    description: "The amount to withdraw."
                }
            },
            required: ["user_level", "amount"]
        }
    },
    {
        name: "update_knowledge",
        description: "Updates the knowledge file by replacing a specific line/section. Use this ONLY when the user explicitly confirms a change.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                target_section: {
                    type: SchemaType.STRING,
                    description: "The section header related to the change (e.g., 'Withdrawal Rules')."
                },
                old_content: {
                    type: SchemaType.STRING,
                    description: "The specific line to be replaced."
                },
                new_content: {
                    type: SchemaType.STRING,
                    description: "The new line to insert."
                },
                rationale: {
                    type: SchemaType.STRING,
                    description: "A brief reason for the change."
                }
            },
            required: ["target_section", "old_content", "new_content", "rationale"]
        }
    },
    {
        name: "get_knowledge",
        description: "Reads the raw content of the current PRD file (history_prd.md). Useful for line-level edits.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {},
        }
    },
    // --- Ingestion Agent Tools ---
    getTaxonomyDeclaration,
    proposeNewCategoryDeclaration,
    writeSubgraphDeclaration,
    // --- Admin Chat Tools ---
    reviewTaxonomyQueueDeclaration,
    // --- Copilot Pipeline Tools ---
    simulateImpactDeclaration,
    draftPrdDeclaration,
    compareRequirementsDeclaration,
    traceDependenciesDeclaration
];

// --- Express Server ---
const app = express();
app.use(cors());
app.use(express.json());

const PORT = 8002;

// --- Microservice APIs for Worker ---
app.post('/api/analyze-conflict', async (req, res) => {
    try {
        const { new_requirement, retrieved_context } = req.body;
        if (!new_requirement || !retrieved_context) {
            return res.status(400).json({ error: 'new_requirement and retrieved_context are required' });
        }

        console.log(`[API] Received conflict analysis request for new requirement: ${new_requirement.substring(0, 30)}...`);
        const result = await checkConflict({ new_requirement, retrieved_context });
        res.json(result);
    } catch (e: any) {
        console.error("Error in /api/analyze-conflict:", e);
        res.status(500).json({ error: e.message });
    }
});

// --- Project Endpoints ---
app.get('/projects', async (req, res) => {
    try {
        const { query, domainId } = req.query;
        let whereClause: any = {
            status: 'EFFECTIVE',
            projectName: { not: null }
        };

        if (domainId) {
            whereClause.domainId = String(domainId);
        }

        if (query) {
            whereClause.projectName = { contains: String(query), mode: 'insensitive' };
        }

        // Find unique project names from Effective documents
        const docs = await prisma.document.findMany({
            where: whereClause,
            select: { projectName: true },
            distinct: ['projectName'],
            orderBy: { projectName: 'asc' },
            take: 10
        });

        const projects = docs
            .filter(d => Boolean(d.projectName) && String(d.projectName).trim() !== "")
            .map((d, idx) => ({
                id: `proj-${idx}`,
                name: d.projectName
            }));

        res.json(projects);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// --- Session Management Endpoints ---

// Get all sessions
app.get('/sessions', async (req, res) => {
    try {
        const { domainId } = req.query;
        let whereClause = {};
        if (domainId) {
            whereClause = { domainId: String(domainId) };
        } else {
            whereClause = { domainId: null };
        }

        const sessions = await prisma.session.findMany({
            where: whereClause,
            orderBy: { updatedAt: 'desc' }
        });
        res.json(sessions);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// Create a new session
app.post('/sessions', async (req, res) => {
    try {
        const { domainId } = req.body || {};
        const session = await prisma.session.create({
            data: {
                title: "New Chat",
                domainId: domainId || null
            }
        });
        res.json(session);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// Delete a session
app.delete('/sessions/:id', async (req, res) => {
    try {
        await prisma.session.delete({ where: { id: req.params.id } });
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// Get messages for a session
app.get('/sessions/:id/messages', async (req, res) => {
    try {
        const messages = await prisma.message.findMany({
            where: { sessionId: req.params.id },
            orderBy: { createdAt: 'asc' }
        });
        res.json(messages);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/chat', async (req, res) => {
    const { query, sessionId, domainId, projectName } = req.body;

    if (!query || !sessionId) {
        return res.status(400).json({ error: 'Query and sessionId are required.' });
    }

    // Load actual history from DB
    const dbMessages = await prisma.message.findMany({
        where: { sessionId },
        orderBy: { createdAt: 'asc' }
    });

    // Update session title on first message
    if (dbMessages.length === 0) {
        // Simple heuristic for title
        await prisma.session.update({
            where: { id: sessionId },
            data: { title: query.substring(0, 30) }
        });
    }

    // Save User Message to DB immediately
    await prisma.message.create({
        data: {
            sessionId: sessionId,
            role: 'user',
            content: query
        }
    });

    // Setup SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const emitEvent = (data: any) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
        let modelTag = "qwen-plus";
        try {
            const val = await redis.get("nexis:settings:llm_provider");
            if (val) modelTag = val;
        } catch (err) {
            console.error("Redis fetch failed defaulting to gemini", err);
        }

        const systemPrompt = `You are 'Nexis', an Advanced Business Analyst Agent.
                
**Your Core Loop (ReAct):**
1. **Retrieve**: When the user asks a question or proposes a change, FIRST use \`retrieve_knowledge\` to gather context (Vector + Graph).
2. **Reason**: Analyze the retrieved info. Does the user's request conflict with existing rules? Is it ambiguous?
3. **Act**: 
    - If checking for consistency, call \`check_conflict\` with the context you found.
    - If making a change, DISCUSS with the user first, then use \`update_knowledge\`.
    - If answering a question, uses the retrieved knowledge.

**Taxonomy Management (AI Suggestions Queue):**
- If the user asks about new, pending, or AI-suggested categories, use \`review_taxonomy_queue\` with action="FETCH" to see the list.
- If the user asks you to approve or reject them, use \`review_taxonomy_queue\` with action="APPROVE" or "REJECT". Always confirm the exact paths you will approve before executing.

**Key Rule**: Do not guess. If you lack info, Retrieve it.
**Information Separation Rule**: When answering, prioritize facts retrieved from the Knowledge Base (Nexis PRD) and label them '【基于知识库】'. ONLY include your own general industry knowledge (labeled '【通用行业知识补充】') IF the retrieved facts are insufficient or if the user asks for a broader explanation. If the PRD knowledge alone answers the user's question completely, DO NOT add unnecessary general knowledge.

**Entity / Project Name Anti-Hallucination Rule (CRITICAL)**: 
1. If the user asks about a specific project, system, or document (e.g., "Project A"), you MUST deeply check the 'source' filename in the retrieved context. 
2. DO NOT assume a file is about "Project A" if its name does not explicitly contain "Project A". (e.g., if the file is named "Project B.docx", it is ONLY about Project B, NOT Project A).
3. If the retrieved sources do not match the requested project name, you MUST reply: "【基于知识库】：未在知识库中找到关于特定项目或文档《X》的专属内容，但我为您找到了《Y》的相关功能..."
4. NEVER say "Project X (即 Project Y)" or "Project X is Project Y". They are DIFFERENT THINGS unless explicitly and factually stated in the text.

**Semantic Retrieval Rule (CRITICAL)**:
When formulating the \`query\` argument for \`retrieve_knowledge\`, DO NOT over-abstract. If the user's prompt contains specific, highly-contextual nouns or features (e.g. '导流路径', '审批流', '回帖路径'), you MUST include those EXACT terms in your query string. Searching for generic terms like "新增功能" will fail to retrieve highly-specific vector chunks.

**Metadata Anti-Distraction Rule (CRITICAL)**: 
1. DO NOT search for technical identifiers, file extensions (e.g., .docx, .pdf, .md), or date-strings (e.g., 20221227) found in the 'Source' labels or context of retrieved results. 
2. These are system metadata, not business concepts. Searching for them leads to infinite loops and poor performance.

**Proactive Copilot Rule (CRITICAL)**:
If the user uses "what if" scenarios (e.g., "如果支持...", "可以实现吗") to ask about adding a new capability, proposing a process change, or asking for a DRAFT PRD, you MUST immediately call \`simulate_impact\` first. Once that returns the Feasibility Impact Report, if they asked for a PRD, you MUST call \`draft_prd\` next. You are acting as an active Business Architect.
NEVER attempt to write or draft a PRD directly in the chat response. You MUST ALWAYS use the \`draft_prd\` tool to generate it.`;

        let finalText = "";
        const executedTools = [];

        if (modelTag.toLowerCase().includes('qwen') || modelTag.toLowerCase().includes('gpt')) {
            // -- OPENAI COMPATIBLE EXECUTION (Qwen-Plus) --
            const openaiTools = tools.map(t => ({
                type: "function" as const,
                function: {
                    name: t.name,
                    description: t.description,
                    parameters: t.parameters as unknown as Record<string, unknown>
                }
            }));

            const messages: any[] = [
                { role: "system", content: systemPrompt }
            ];

            // Map DB history to OpenAI format
            if (dbMessages && dbMessages.length > 0) {
                for (const msg of dbMessages) {
                    messages.push({
                        role: msg.role === 'assistant' ? 'assistant' : 'user',
                        content: msg.content
                    });
                }
            }
            const promptContext = projectName ? `[Project Context: ${projectName}]\n${query}` : query;
            messages.push({ role: "user", content: promptContext });

            let loopCount = 0;
            while (loopCount < 8) {
                loopCount++;
                let completion: any;
                try {
                    completion = await openai.chat.completions.create({
                        model: modelTag,
                        messages: messages,
                        tools: openaiTools,
                        tool_choice: "auto"
                    });
                } catch (completionError: any) {
                    console.error("OpenAI/Qwen API Rejection Error:", completionError.message, JSON.stringify(completionError, null, 2));
                    throw new Error(`OpenAI API Error: ${completionError.message}`);
                }

                const msg = completion.choices[0].message;
                messages.push(msg);

                if (!msg.tool_calls || msg.tool_calls.length === 0) {
                    finalText = msg.content || "";
                    break;
                }

                for (const call of msg.tool_calls) {
                    const fcall = (call as any).function;
                    const name = fcall.name;
                    const args = JSON.parse(fcall.arguments || "{}");

                    emitEvent({ type: 'tool', name, args });
                    executedTools.push({ name, args });

                    let toolResult: any;
                    try {
                        if (name === "retrieve_knowledge") {
                            toolResult = await retrieveKnowledge({ ...args, projectName }, domainId);
                        } else if (name === "check_conflict") {
                            toolResult = await checkConflict(args);
                        } else if (name === "withdraw_skill") {
                            toolResult = await withdrawSkill(args);
                        } else if (name === "update_knowledge") {
                            toolResult = updateKnowledge(args);
                        } else if (name === "get_knowledge") {
                            toolResult = { content: loadKnowledge() };
                        } else if (name === "review_taxonomy_queue") {
                            toolResult = await reviewTaxonomyQueue(args, domainId);
                        } else if (name === "simulate_impact") {
                            toolResult = await simulateImpact({ ...args, projectName });
                        } else if (name === "draft_prd") {
                            toolResult = await draftPrd(args);
                        } else if (name === "compare_requirements") {
                            toolResult = await compareRequirements(args);
                        } else if (name === "trace_dependencies") {
                            toolResult = await traceDependencies(args);
                        } else {
                            toolResult = { error: `Unknown tool: ${name}` };
                        }
                    } catch (e: any) {
                        console.error("Tool execution error:", e);
                        toolResult = { error: `Tool execution failed: ${e.message}` };
                    }

                    messages.push({
                        role: "tool",
                        tool_call_id: call.id,
                        name: name,
                        content: JSON.stringify(toolResult)
                    });
                }
            }

        } else {
            // -- GEMINI NATIVE EXECUTION --
            const model = genAI.getGenerativeModel({
                model: "gemini-3-flash-preview",
                tools: [{ functionDeclarations: tools }],
            });

            // Initialize chat history with system prompt
            const formattedHistory = [
                {
                    role: "user",
                    parts: [{ text: systemPrompt }]
                },
                {
                    role: "model",
                    parts: [{ text: "Understood. I will always Retrieve, Reason, then Act. Ready to assist." }]
                }
            ];

            // Format db history format to Gemini history format
            if (dbMessages && dbMessages.length > 0) {
                for (const msg of dbMessages) {
                    formattedHistory.push({
                        role: msg.role === 'assistant' ? 'model' : 'user',
                        parts: [{ text: msg.content }]
                    });
                }
            }

            const chat = model.startChat({ history: formattedHistory as any });

            const promptContext = projectName ? `[Project Context: ${projectName}]\n${query}` : query;
            let result = await chat.sendMessage(promptContext);
            let response = result.response;

            // ReAct Loop for Tool Calling
            let geminiLoopCount = 0;
            while (response.functionCalls() && geminiLoopCount < 8) {
                geminiLoopCount++;
                const functionCalls = response.functionCalls();
                if (!functionCalls) break;

                const functionResponses = [];

                for (const call of functionCalls) {
                    const name = call.name;
                    const args = call.args as any;

                    // Emit Tool Event to frontend
                    emitEvent({ type: 'tool', name, args });
                    executedTools.push({ name, args });

                    let toolResult: any;

                    try {
                        if (name === "retrieve_knowledge") {
                            toolResult = await retrieveKnowledge({ ...args, projectName }, domainId);
                        } else if (name === "check_conflict") {
                            toolResult = await checkConflict(args);
                        } else if (name === "withdraw_skill") {
                            toolResult = await withdrawSkill(args);
                        } else if (name === "update_knowledge") {
                            toolResult = updateKnowledge(args);
                        } else if (name === "get_knowledge") {
                            toolResult = { content: loadKnowledge() };
                        } else if (name === "review_taxonomy_queue") {
                            toolResult = await reviewTaxonomyQueue(args, domainId);
                        } else if (name === "simulate_impact") {
                            toolResult = await simulateImpact({ ...args, projectName });
                        } else if (name === "draft_prd") {
                            toolResult = await draftPrd(args);
                        } else if (name === "compare_requirements") {
                            toolResult = await compareRequirements(args);
                        } else if (name === "trace_dependencies") {
                            toolResult = await traceDependencies(args);
                        } else {
                            toolResult = { error: `Unknown tool: ${name}` };
                        }
                    } catch (e: any) {
                        console.error("Tool execution error:", e);
                        toolResult = { error: `Tool execution failed: ${e.message}` };
                    }

                    functionResponses.push({
                        functionResponse: {
                            name: name,
                            response: typeof toolResult === "object" ? toolResult : { result: toolResult }
                        }
                    });
                }

                // Send tool results back to the model
                console.log(`[Gemini Loop] Sending back ${functionResponses.length} function responses`);
                try {
                    result = await chat.sendMessage(functionResponses);
                    response = result.response;
                } catch (err: any) {
                    console.error("Gemini context send error:", err);
                    break;
                }
            }
            finalText = response.text();
        }

        emitEvent({ type: 'text', text: finalText });

        // Asynchronously save Assistant Message and tools to DB
        await prisma.message.create({
            data: {
                sessionId: sessionId,
                role: 'assistant',
                content: finalText,
                tools: executedTools.length > 0 ? executedTools : undefined
            }
        });

    } catch (error: any) {
        console.error("Agent execution error:", error);
        emitEvent({ type: 'error', error: error.message || 'Agent error.' });
    }

    emitEvent({ type: 'done' });
    emitEvent('[DONE]');
    res.end();
});

// --- PI-INSPIRED INGESTION AGENT ---
app.post('/ingest-chunk', async (req, res) => {
    const { text, domainId, source, projectName, provider } = req.body;
    const modelTag = provider || "gemini-3-flash-preview";

    if (!text || !domainId) {
        return res.status(400).json({ error: 'text and domainId are required.' });
    }

    try {
        const systemPrompt = `You are a Minimal Ingestion Agent. Your task is to process the following raw text chunk and integrate its core entities into the Neo4j knowledge graph according to the overarching Taxonomy.
Rules:
1. You MUST first use the 'get_taxonomy' tool to understand the valid categories for this domain. This tool returns absolute hierarchical paths (e.g., 'Root > Parent > Child').
2. If the text clearly belongs to an existing category, extract the entities and relationships, and use the 'write_subgraph' tool to link them to that specific category.
3. If the text introduces novel concepts that DO NOT remotely fit existing taxonomy categories, you MUST use the 'propose_new_category' tool to formally request a new category, which returns a suggestionId. Then use 'write_subgraph' to link your extracted entities to that suggestionId.
4. IMPORTANT: Any proposed category path MUST be an absolute path starting from an existing ROOT category (e.g., '票据业务 > 新分类'). DO NOT propose a partial path without its parent roots.

Raw Text Chunk:
${text}
`;

        if (modelTag.toLowerCase().includes('qwen') || modelTag.toLowerCase().includes('gpt')) {
            // -- OPENAI COMPATIBLE EXECUTION (Qwen-Plus) --
            const openaiTools = tools.map(t => ({
                type: "function" as const,
                function: {
                    name: t.name,
                    description: t.description,
                    parameters: t.parameters as unknown as Record<string, unknown>
                }
            }));

            const messages: any[] = [
                { role: "system", content: systemPrompt },
                { role: "user", content: "Begin extraction process." }
            ];

            let loopCount = 0;
            let finalOutput = "";

            while (loopCount < 5) {
                loopCount++;
                const completion = await openai.chat.completions.create({
                    model: modelTag,
                    messages: messages,
                    tools: openaiTools,
                    tool_choice: "auto"
                });

                const msg = completion.choices[0].message;
                messages.push(msg);

                if (!msg.tool_calls || msg.tool_calls.length === 0) {
                    finalOutput = msg.content || "";
                    break;
                }

                for (const call of msg.tool_calls) {
                    const fcall = (call as any).function;
                    console.log(`[Ingestion Agent - Qwen] Calling Tool: ${fcall.name}`);
                    let toolResult: any = {};
                    try {
                        const args = JSON.parse(fcall.arguments || "{}");
                        if (fcall.name === 'get_taxonomy') {
                            toolResult = await getTaxonomy({ domainId });
                        } else if (fcall.name === 'propose_new_category') {
                            toolResult = await proposeNewCategory({ ...args, domainId });
                        } else if (fcall.name === 'write_subgraph') {
                            toolResult = await writeSubgraph({ ...args, domainId, sourceDocument: source, projectName, extractedBy: modelTag });
                        } else {
                            toolResult = { error: `Unknown tool for ingestion: ${fcall.name}` };
                        }
                    } catch (e: any) {
                        toolResult = { error: e.message };
                    }

                    messages.push({
                        role: "tool",
                        tool_call_id: call.id,
                        name: fcall.name,
                        content: JSON.stringify(toolResult)
                    });
                }
            }
            res.json({ status: "success", cycles: loopCount, finalAgentText: finalOutput });

        } else {
            // -- GEMINI NATIVE EXECUTION --
            const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" }, { apiVersion: "v1beta" });
            const chatSession = model.startChat({
                tools: [{ functionDeclarations: tools }]
            });

            let result = await chatSession.sendMessage([{ text: systemPrompt }]);
            let response = result.response;
            let loopCount = 0;

            // ReAct loop
            while (response.functionCalls() && loopCount < 5) {
                loopCount++;
                const functionCalls = response.functionCalls();
                if (!functionCalls) break;

                const functionResponses = [];

                for (const call of functionCalls) {
                    console.log(`[Ingestion Agent - Gemini] Calling Tool: ${call.name}`);
                    let toolResult: any = {};
                    try {
                        const args = call.args as any;
                        if (call.name === 'get_taxonomy') {
                            toolResult = await getTaxonomy({ domainId });
                        } else if (call.name === 'propose_new_category') {
                            toolResult = await proposeNewCategory({ ...args, domainId });
                        } else if (call.name === 'write_subgraph') {
                            toolResult = await writeSubgraph({ ...args, domainId, sourceDocument: source, projectName, extractedBy: modelTag });
                        } else {
                            toolResult = { error: `Unknown tool for ingestion: ${call.name}` };
                        }
                    } catch (e: any) {
                        toolResult = { error: e.message };
                    }

                    functionResponses.push({
                        functionResponse: {
                            name: call.name,
                            response: toolResult
                        }
                    });
                }

                result = await chatSession.sendMessage(functionResponses);
                response = result.response;
            }

            res.json({ status: "success", cycles: loopCount, finalAgentText: response.text() });
        }

    } catch (e: any) {
        console.error("Ingestion agent error:", e);
        res.status(500).json({ error: e.message });
    }
});

app.listen(PORT, () => {
    console.log(`Agent API Server listening at http://localhost:${PORT}`);
});
