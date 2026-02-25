import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env from project root if not found locally
const rootEnvPath = path.resolve(__dirname, '../../../.env');
dotenv.config({ path: rootEnvPath });
dotenv.config(); // Fallback to default

import express from 'express';
import cors from 'cors';
import { GoogleGenerativeAI, FunctionDeclaration, SchemaType } from '@google/generative-ai';
import * as fs from 'fs';
import { checkConflict } from './skills/conflict-checker';
import { withdrawSkill } from './skills/withdraw-skill';
import { retrieveKnowledge } from './skills/retrieve-knowledge';
import { updateKnowledge } from './skills/update-knowledge';
import { prisma } from './db';

// --- Configuration ---
const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
    console.error('Error: GEMINI_API_KEY is not set in environment variables.');
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(API_KEY);
const KNOWLEDGE_PATH = path.join(process.cwd(), 'knowledge', 'history_prd.md');

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
    }
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
    const { query, sessionId, domainId } = req.body;

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
        const model = genAI.getGenerativeModel({
            model: "gemini-3-flash-preview",
            tools: [{ functionDeclarations: tools }],
        });

        // Initialize chat history with system prompt
        const formattedHistory = [
            {
                role: "user",
                parts: [{
                    text: `
                You are 'Nexis', an Advanced Business Analyst Agent.
                
                **Your Core Loop (ReAct):**
                1. **Retrieve**: When the user asks a question or proposes a change, FIRST use \`retrieve_knowledge\` to gather context (Vector + Graph).
                2. **Reason**: Analyze the retrieved info. Does the user's request conflict with existing rules? Is it ambiguous?
                3. **Act**: 
                   - If checking for consistency, call \`check_conflict\` with the context you found.
                   - If making a change, DISCUSS with the user first, then use \`update_knowledge\`.
                   - If answering a question, uses the retrieved knowledge.
                
                **Key Rule**: Do not guess. If you lack info, Retrieve it.
                **Information Separation Rule**: When answering, prioritize facts retrieved from the Knowledge Base (Nexis PRD) and label them '【基于知识库】'. ONLY include your own general industry knowledge (labeled '【通用行业知识补充】') IF the retrieved facts are insufficient or if the user asks for a broader explanation. If the PRD knowledge alone answers the user's question completely, DO NOT add unnecessary general knowledge.
                ` }]
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

        let result = await chat.sendMessage(query);
        let response = result.response;

        const executedTools = [];

        // ReAct Loop for Tool Calling
        while (response.functionCalls()) {
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
                        toolResult = await retrieveKnowledge(args, domainId);
                    } else if (name === "check_conflict") {
                        toolResult = await checkConflict(args);
                    } else if (name === "withdraw_skill") {
                        toolResult = await withdrawSkill(args);
                    } else if (name === "update_knowledge") {
                        toolResult = updateKnowledge(args);
                    } else if (name === "get_knowledge") {
                        toolResult = { content: loadKnowledge() };
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
                        response: toolResult
                    }
                });
            }

            // Send tool results back to the model
            result = await chat.sendMessage(functionResponses);
            response = result.response;
        }

        const finalText = response.text();
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

app.listen(PORT, () => {
    console.log(`Agent API Server listening at http://localhost:${PORT}`);
});
