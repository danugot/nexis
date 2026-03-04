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
import { withdrawSkill } from './skills/withdraw-skill';
import { retrieveKnowledge } from './skills/retrieve-knowledge';
import { updateKnowledge } from './skills/update-knowledge';
import { knowledgeOrchestratorDeclaration, knowledgeOrchestrator } from "./skills/knowledge-orchestrator";
import { requirementAnalyzerDeclaration, requirementAnalyzer } from "./skills/requirement-analyzer";
import { dependencyImpactAnalyzerDeclaration, dependencyImpactAnalyzer } from "./skills/dependency-impact-analyzer";




import { reviewTaxonomyQueueDeclaration, reviewTaxonomyQueue } from './skills/review-taxonomy-queue';

import { draftPrdDeclaration, draftPrd } from './skills/draft-prd';



import { generateTestsDeclaration, generateTests } from './skills/generate-tests';



import { getDocumentContentDeclaration, getDocumentContent } from './skills/get-document-content';
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

const redis = new Redis(process.env.REDIS_URL || 'redis://redis:6379');

function loadKnowledge(): string {
    if (fs.existsSync(KNOWLEDGE_PATH)) {
        return fs.readFileSync(KNOWLEDGE_PATH, 'utf-8');
    }
    return "";
}

// --- Tool Definitions (Schema) ---
const chatTools: FunctionDeclaration[] = [
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
    requirementAnalyzerDeclaration,
    dependencyImpactAnalyzerDeclaration,
    draftPrdDeclaration
];

const ingestTools: FunctionDeclaration[] = [
    knowledgeOrchestratorDeclaration
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
        // requirementAnalyzer handles 'check_conflict' action. It uses requirement_text.
        const result = await requirementAnalyzer({ action: 'check_conflict', requirement_text: new_requirement, projectName: "default" });
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
        try {
            await prisma.session.update({
                where: { id: sessionId },
                data: { title: query.substring(0, 30) }
            });
        } catch (e) {
            console.warn(`Could not update session title for ${sessionId}:`, e);
        }
    }

    // Save User Message to DB immediately
    await prisma.message.create({
        data: {
            sessionId: sessionId,
            role: 'user',
            content: query
        }
    });

    // Extract Document IDs from chat history for SANDBOX context isolation
    const documentIds: string[] = [];
    const extractFileIds = (text: string) => {
        const matches = [...text.matchAll(/\[FileId:\s*([^\]]+)\]/g)];
        for (const match of matches) {
            if (match[1] && !documentIds.includes(match[1])) {
                documentIds.push(match[1]);
            }
        }
    };
    extractFileIds(query);
    for (const msg of dbMessages) {
        extractFileIds(msg.content);
    }

    // Setup SSE
    req.setTimeout(0); // Disable request timeout for long Mega-Tool runs
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Start SSE Heartbeat to keep intermediate proxies (like Nginx) alive
    const heartbeatInterval = setInterval(() => {
        res.write(':\\n\\n');
    }, 15000);

    req.on('close', () => {
        clearInterval(heartbeatInterval);
    });

    const executedTools = [];

    const emitEvent = (data: any) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // --- Smart Intent Engine (Coreference & Tool Dispatch) ---
    let rewrittenQuery = query;
    let forceToolTrigger = false;
    let forcedToolName: string | null = null;
    let forcedToolIntent: string | null = null;
    let isInformationalQuery = true; // Safe default for simple informational queries

    try {
        emitEvent({ type: 'audit_progress', message: '分析上下文意图与指代...', step: 1 });
        const recentHistory = dbMessages.slice(-4).map(m => `${m.role.toUpperCase()}: ${m.content}`).join("\n");
        const intentPrompt = `
You are a fast, strict Intent & Coreference Router.

Recent History:
${recentHistory}

User Query: "${query}"

RULES:
1. "rewritten_query": Resolve pronouns and vague context (e.g., "继续" -> "继续按上文流程分析"). MUST BE IN CHINESE. MUST BE EXTREMELY CONCISE (under 15 words). Do NOT translate to English. Do NOT add complex system instructions. If the query is already clear, return it EXACTLY as is.
2. "trigger_tool": ONLY set to true if the User is EXPLICITLY agreeing to use a tool that the Assistant JUST suggested in the history.
3. "tool_intent": If triggering a tool, provide a CONCISE description in Chinese.
4. "is_informational_query": Set to TRUE if the user is asking a straightforward informational question (e.g., "有哪些错误码", "流程是什么", "分析发生的原因等客观知识抽取"). Set to FALSE ONLY if the user is asking to simulate changes, trace dependencies in codebase/DB, or draft documents (e.g., "如果要增加人脸识别", "生成PRD"). WHEN IN DOUBT, SET TO TRUE.

Return ONLY valid JSON (no markdown):
{
   "rewritten_query": "string (strictly concise, Chinese)",
   "trigger_tool": boolean,
   "tool_name": "requirement_analyzer" | "dependency_impact_analyzer" | "draft_prd" | null,
   "tool_intent": "string or null",
   "is_informational_query": boolean
}
`;
        const openaiClient = new OpenAI({
            apiKey: process.env.DASHSCOPE_API_KEY || "sk-dummy",
            baseURL: process.env.OPENAI_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1"
        });
        const intentResp = await openaiClient.chat.completions.create({
            model: "qwen-turbo",
            messages: [{ role: "user", content: intentPrompt }]
        });
        const intentJsonStr = intentResp.choices[0].message.content || "{}";
        const intentResult = JSON.parse(intentJsonStr.replace(/```json/g, '').replace(/```/g, '').trim());

        if (intentResult.rewritten_query) {
            rewrittenQuery = intentResult.rewritten_query;
            console.log(`[Intent Engine] Rewrote query to: ${rewrittenQuery}`);
        }
        if (intentResult.is_informational_query === false) {
            isInformationalQuery = false;
            console.log(`[Intent Engine] Mega-Tool analysis required. Permitting full access.`);
        } else {
            console.log(`[Intent Engine] Informational Query Detected. Stripping Mega-Tools to prevent over-engineering.`);
        }
        if (intentResult.trigger_tool && intentResult.tool_name) {
            forceToolTrigger = true;
            forcedToolName = intentResult.tool_name;
            forcedToolIntent = intentResult.tool_intent || rewrittenQuery;
            console.log(`[Intent Engine] Tool Trigger Detected: ${forcedToolName}`);
        }
    } catch (e) {
        console.error("Intent Engine failed, falling back to original query:", e);
    }

    // --- Implicit Pre-Retrieval (Auto-Context) ---
    let autoContext = "";

    try {
        console.log(`[Auto-Context] Fetching pre-retrieval for rewritten query: ${rewrittenQuery.substring(0, 30)}...`);
        emitEvent({ type: 'audit_progress', message: '检索核心知识库...', step: 2 });
        emitEvent({ type: 'tool', name: 'retrieve_knowledge', args: { query: rewrittenQuery } });
        executedTools.push({ name: 'retrieve_knowledge', args: { query: rewrittenQuery } });

        const ragResult = await retrieveKnowledge({ query: rewrittenQuery, projectName, documentIds }, domainId);
        autoContext = typeof ragResult === 'object' ? JSON.stringify(ragResult) : String(ragResult);

        emitEvent({ type: 'tool_result', name: 'retrieve_knowledge', result: ragResult });
    } catch (e) {
        console.error("Auto-Context retrieval failed:", e);
        emitEvent({ type: 'tool_result', name: 'retrieve_knowledge', result: { error: "Auto-Context Failed" } });
    }

    try {
        let modelTag = "qwen-plus";
        try {
            const val = await redis.get("nexis:settings:llm_provider");
            if (val) modelTag = val;
        } catch (err) {
            console.error("Redis fetch failed defaulting to gemini", err);
        }

        const systemPrompt = `You are 'Nexis', a precise Advanced Business Analyst Agent.
You MUST rely on the [System Auto-Context] provided below to answer the user's questions.

**CRITICAL ANSWERING RULES**:
1. **BE DIRECT AND HIGHLY SPECIFIC**: Do not give abstract summaries. If the user asks about a "流程" (Process) or "规则" (Rule), you MUST extract the exact steps, conditions, or rules mentioned in the Context. If the context says Step A -> Step B, output Step A -> Step B.
2. **DO NOT WANDER**: Do not say "it is related to X and Y" if the user asked "What is the process?". Just give the process directly.
3. Label facts from the context as '【基于知识库】'.
4. If the [System Auto-Context] does not contain enough specific details to answer the exact question, you may call \`retrieve_knowledge\` manually with a more specific query.
${forceToolTrigger ? `
**INTENT ENGINE OVERRIDE (CRITICAL DIRECTIVE)**:
The User has explicitly agreed to your previous suggestion to use a tool.
YOU MUST IMMEDIATELY and EXCLUSIVELY call the tool \`${forcedToolName}\` with the intent text: "${forcedToolIntent}".
DO NOT provide conversational filler. DO NOT summarize. JUST EXECUTE THE TOOL CALL NOW.
` : ''}`;

        let finalText = "";

        let finalChatTools = chatTools;
        if (isInformationalQuery && !forceToolTrigger) {
            // Strip mega tools completely for simple informational queries
            finalChatTools = chatTools.filter(t => !['requirement_analyzer', 'dependency_impact_analyzer', 'draft_prd'].includes(t.name));
        }

        if (modelTag.toLowerCase().includes('qwen') || modelTag.toLowerCase().includes('gpt')) {
            // -- OPENAI COMPATIBLE EXECUTION (Qwen-Plus) --
            const openaiTools = finalChatTools.map(t => ({
                type: "function" as const,
                function: {
                    name: t.name,
                    description: t.description,
                    parameters: t.parameters as unknown as Record<string, unknown>
                }
            }));

            // Map DB history to OpenAI format first
            const pastMessages: any[] = [];
            if (dbMessages && dbMessages.length > 0) {
                for (const msg of dbMessages) {
                    let contentToPush = msg.content;
                    if (isInformationalQuery && msg.role === 'assistant') {
                        // Purge toxic context from previous turns to prevent hallucinating Mega-Tools
                        contentToPush = contentToPush.replace(/下一步行动建议[\s\S]*/g, '').trim();
                        contentToPush = contentToPush.replace(/dependency_impact_analyzer/g, '[Redacted Tool]');
                        contentToPush = contentToPush.replace(/requirement_analyzer/g, '[Redacted Tool]');
                        contentToPush = contentToPush.replace(/draft_prd/g, '[Redacted Tool]');
                    }
                    pastMessages.push({
                        role: msg.role === 'assistant' ? 'assistant' : 'user',
                        content: contentToPush
                    });
                }
            }

            // Build Contextual System Prompt
            // By putting Auto-Context here instead of in the user's latest message,
            // we preserve the conversational continuity for short queries like "continue"
            let contextualSystemPrompt = `${systemPrompt}
            
---
[Pre-Retrieved System Auto-Context For Current Query]
${autoContext}

[Project Scope: ${projectName || 'None'}]
---`;

            if (isInformationalQuery && !forceToolTrigger) {
                contextualSystemPrompt += `\n\n**ANTI-HALLUCINATION DIRECTIVE**: You are answering a simple informational query. DO NOT offer, suggest, or attempt to use tools like \`requirement_analyzer\`, \`dependency_impact_analyzer\`, or \`draft_prd\` in your response footer, even if you did so previously in this chat history. DO NOT output "下一步行动建议" or act as an architect. Just provide the direct answer.`;
            }

            const messages: any[] = [
                { role: "system", content: contextualSystemPrompt },
                ...pastMessages
            ];


            const promptContext = query; // Just the query, keep it conversational
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
                        tool_choice: "auto",
                        max_tokens: 4096
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
                    let args: any = {};
                    try {
                        args = JSON.parse(fcall.arguments || "{}");
                    } catch (parseError: any) {
                        console.error(`[CRITICAL] Failed to parse tool arguments for ${name}:`, fcall.arguments);
                        // Fallback: If it's truncated, try to close it if it's a simple string, 
                        // but better to just report error to the model
                        const errorMsg = `Tool call arguments for '${name}' were malformed or truncated. Please try again with a more concise summary.`;
                        messages.push({
                            role: "tool",
                            tool_call_id: call.id,
                            content: JSON.stringify({ error: errorMsg })
                        });
                        continue;
                    }

                    emitEvent({ type: 'tool', name, args });
                    executedTools.push({ name, args });

                    let toolResult: any;
                    try {
                        if (name === "retrieve_knowledge") {
                            toolResult = await retrieveKnowledge({ ...args, projectName, documentIds }, domainId);
                        } else if (name === "check_conflict") {
                            toolResult = await requirementAnalyzer({ action: 'check_conflict', ...args, requirement_text: args.new_requirement }, domainId);
                        } else if (name === "withdraw_skill") {
                            toolResult = await withdrawSkill(args);
                        } else if (name === "update_knowledge") {
                            toolResult = updateKnowledge(args);
                        } else if (name === "get_knowledge") {
                            toolResult = { content: loadKnowledge() };
                        } else if (name === "review_taxonomy_queue") {
                            toolResult = await reviewTaxonomyQueue(args, domainId);
                        } else if (name === "dependency_impact_analyzer") {
                            toolResult = await dependencyImpactAnalyzer({ ...args, projectName });
                        } else if (name === "draft_prd") {
                            toolResult = await draftPrd({ ...args, projectName });
                        } else if (name === "requirement_analyzer") {
                            toolResult = await requirementAnalyzer({ ...args, projectName }, domainId);
                        } else if (name === "get_document_content") {
                            toolResult = await getDocumentContent(args.fileId);
                        } else {
                            toolResult = { error: `Unknown tool: ${name}` };
                        }
                        emitEvent({ type: 'tool_result', name, result: toolResult });
                    } catch (e: any) {
                        console.error("Tool execution error:", e);
                        toolResult = { error: `Tool execution failed: ${e.message}` };
                    }

                    let llmContextResult = toolResult;
                    if (name === "draft_prd" && toolResult.prd_markdown) {
                        llmContextResult = { status: "success", message: "PRD Generation Complete. The document has been presented to the user directly, do not rewrite the PRD yourself." };
                    }

                    messages.push({
                        role: "tool",
                        tool_call_id: call.id,
                        name: name,
                        content: JSON.stringify(llmContextResult)
                    });
                }
            }

        } else {
            // -- GEMINI NATIVE EXECUTION --
            const model = genAI.getGenerativeModel({
                model: "gemini-3-flash-preview",
                tools: [{ functionDeclarations: finalChatTools }],
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

            // Format db history to Gemini history format
            if (dbMessages && dbMessages.length > 0) {
                for (const msg of dbMessages) {
                    let contentToPush = msg.content;
                    if (isInformationalQuery && msg.role === 'assistant') {
                        // Purge toxic context from previous turns
                        contentToPush = contentToPush.replace(/下一步行动建议[\s\S]*/g, '').trim();
                        contentToPush = contentToPush.replace(/dependency_impact_analyzer/g, '[Redacted Tool]');
                        contentToPush = contentToPush.replace(/requirement_analyzer/g, '[Redacted Tool]');
                        contentToPush = contentToPush.replace(/draft_prd/g, '[Redacted Tool]');
                    }
                    formattedHistory.push({
                        role: msg.role === 'assistant' ? 'model' : 'user',
                        parts: [{ text: contentToPush }]
                    });
                }
            }

            // Inject the Auto-Context right before the latest user message conversationally
            if (autoContext.trim().length > 10) {
                formattedHistory.push({
                    role: "user",
                    parts: [{ text: `[System Auto-Context for reference]:\n${autoContext}\n[Project: ${projectName || 'None'}]` }]
                });
                formattedHistory.push({
                    role: "model",
                    parts: [{ text: "Context acknowledged. I will use this for the next query." }]
                });
            }

            const chat = model.startChat({ history: formattedHistory as any });

            const promptContext = query; // Just the query, keep it conversational
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
                            toolResult = await retrieveKnowledge({ ...args, projectName, documentIds }, domainId);
                        } else if (name === "check_conflict") {
                            toolResult = await requirementAnalyzer({ action: 'check_conflict', ...args, requirement_text: args.new_requirement }, domainId);
                        } else if (name === "withdraw_skill") {
                            toolResult = await withdrawSkill(args);
                        } else if (name === "update_knowledge") {
                            toolResult = updateKnowledge(args);
                        } else if (name === "get_knowledge") {
                            toolResult = { content: loadKnowledge() };
                        } else if (name === "review_taxonomy_queue") {
                            toolResult = await reviewTaxonomyQueue(args, domainId);
                        } else if (name === "dependency_impact_analyzer") {
                            toolResult = await dependencyImpactAnalyzer({ ...args, projectName });
                        } else if (name === "draft_prd") {
                            toolResult = await draftPrd({ ...args, projectName });
                        } else if (name === "requirement_analyzer") {
                            toolResult = await requirementAnalyzer({ ...args, projectName }, domainId);

                            // Phase 3: Persist the Architect Report to the database
                            if (toolResult && toolResult.verdict === "ANALYZED") {
                                console.log(`[Server] Persisting Architect Report for session ${sessionId}`);
                                await prisma.message.create({
                                    data: {
                                        sessionId: sessionId,
                                        role: 'tool',
                                        content: JSON.stringify({ type: 'architect_report', data: toolResult }),
                                        createdAt: new Date()
                                    }
                                });
                            }
                        } else if (name === "get_document_content") {
                            toolResult = await getDocumentContent(args.fileId);
                        } else {
                            toolResult = { error: `Unknown tool: ${name}` };
                        }
                        emitEvent({ type: 'tool_result', name, result: toolResult });
                    } catch (e: any) {
                        console.error("Tool execution error:", e);
                        toolResult = { error: `Tool execution failed: ${e.message}` };
                    }

                    let llmContextResult = typeof toolResult === "object" ? toolResult : { result: toolResult };
                    if (name === "draft_prd" && toolResult.prd_markdown) {
                        llmContextResult = { status: "success", message: "PRD Generation Complete. The document has been presented to the user directly, do not rewrite the PRD yourself." };
                    }

                    functionResponses.push({
                        functionResponse: {
                            name: name,
                            response: llmContextResult
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
    clearInterval(heartbeatInterval);
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
            const openaiTools = ingestTools.map(t => ({
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
                    tool_choice: "auto",
                    max_tokens: 8192
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
                        let argString = fcall.arguments || "{}";
                        let args: any = {};

                        try {
                            args = JSON.parse(argString);
                        } catch (initialParseError) {
                            console.warn(`[Ingestion Agent] Initial JSON parse failed. Attempting to repair truncated JSON.`);
                            // Aggressively try to close truncated JSON arrays/objects
                            try {
                                args = JSON.parse(argString + ']}');
                            } catch (e2) {
                                try {
                                    args = JSON.parse(argString + '}]}');
                                } catch (e3) {
                                    try {
                                        args = JSON.parse(argString + '}');
                                    } catch (e4) {
                                        throw initialParseError; // Give up, throw original error
                                    }
                                }
                            }
                            console.log(`[Ingestion Agent] Successfully repaired truncated JSON.`);
                        }

                        if (fcall.name === 'get_taxonomy' || fcall.name === 'propose_new_category' || fcall.name === 'write_subgraph') {
                            const action = fcall.name;
                            toolResult = await knowledgeOrchestrator({ action, ...args, domainId, sourceDocument: source, status: req.body.status || 'EFFECTIVE', projectName, extractedBy: modelTag });
                        } else {
                            toolResult = { error: `Unknown tool for ingestion: ${fcall.name}` };
                        }
                    } catch (parseError: any) {
                        console.error(`[Ingestion Agent] Tool argument parse error:`, parseError);
                        toolResult = { error: `Invalid JSON in tool arguments: ${parseError.message}. Please output fewer entities/relationships per tool call to fit within limits.` };
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
                tools: [{ functionDeclarations: ingestTools }]
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
                        if (call.name === 'get_taxonomy' || call.name === 'propose_new_category' || call.name === 'write_subgraph') {
                            const action = call.name;
                            toolResult = await knowledgeOrchestrator({ action, ...args, domainId, sourceDocument: source, status: req.body.status || 'EFFECTIVE', projectName, extractedBy: modelTag });
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

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Agent API Server listening at http://0.0.0.0:${PORT}`);
});
