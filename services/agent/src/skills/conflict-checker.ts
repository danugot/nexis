import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";
import * as dotenv from "dotenv";

dotenv.config();

export interface ConflictInput {
    new_requirement: string;
    retrieved_context: string;
}

export interface ConflictResult {
    conflict_detected: boolean;
    reason: string;
    suggestion?: string;
    new_context_snippet?: string;
    old_context_snippet?: string;
}

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const geminiModel = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

// Initialize Qwen (DashScope via OpenAI SDK)
const openai = new OpenAI({
    apiKey: process.env.DASHSCOPE_API_KEY || "sk-dummy",
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1"
});

const RAG_API_URL = process.env.RAG_API_URL || "http://rag_api:8000";

async function queryRAG(query: string): Promise<string> {
    try {
        const response = await fetch(`${RAG_API_URL}/retrieve`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                query: query,
                n_results: 3
            })
        });

        if (response.ok) {
            const data = await response.json();
            if (data.context && Array.isArray(data.context)) {
                return data.context.map((item: any) =>
                    `- [${item.source}]: ${item.content}`
                ).join("\n");
            }
        }
        return "";
    } catch (error) {
        console.warn("RAG Service unavailable, skipping context retrieval.", error);
        return "";
    }
}

async function getProvider(): Promise<string> {
    try {
        const res = await fetch(`${RAG_API_URL}/api/settings`);
        if (res.ok) {
            const data = await res.json();
            return data.llm_provider || "gemini";
        }
    } catch (e) {
        console.warn("Settings API unreached, defaulting to gemini");
    }
    return "gemini";
}

export async function checkConflict(input: ConflictInput): Promise<ConflictResult> {
    const { new_requirement, retrieved_context } = input;
    const provider = await getProvider();

    const ragContext = await queryRAG(new_requirement);

    const prompt = `
    You are 'Nexis', a Senior Product Manager and System Architect.
    Your goal is to identify if the **Target Concept** has conflicting definitions or rules between the **Current Document Text** and **Historical Knowledge (RAG)**.

    === Target Concept ===
    Name: "${new_requirement}"

    === Current Document Text (New Context) ===
    ${retrieved_context}

    === Historical Knowledge (Old Context from Knowledge Base) ===
    ${ragContext || "No related historical context found."}
    
    === Analysis Instructions ===
    1. Read the Current Document Text and extract exactly what it says about the Target Concept (e.g., constraints, states, transitions).
    2. Read the Historical Knowledge and extract what it previously said about the Target Concept.
    3. Check carefully: Are the business rules, limits, definitions, or operational constraints contradictory?
    4. Provide the EXACT snippet or sentence from both sources that demonstrates the contradiction. DO NOT just repeat the entity name.

    Example of Response JSON:
    {
        "conflict_detected": true,
        "new_context_snippet": "If the ticket exceeds 3 days, it will default to '已出票' state.",
        "old_context_snippet": "Tickets exceeding 2 days are forced into '已出票-已锁定'.",
        "reason": "The timeout thresholds (3 days vs 2 days) and the resulting state nomenclature ('已出票' vs '已出票-已锁定') directly contradict each other.",
        "suggestion": "Clarify the correct timeout threshold and standardize the resulting business state."
    }

    Return ONLY valid JSON matching the schema above.
    `;

    try {
        let text = "";

        if (provider === "qwen-plus") {
            const completion = await openai.chat.completions.create({
                model: "qwen3.5-plus",
                messages: [{ role: "user", content: prompt }]
            });
            text = completion.choices[0].message.content || "";
        } else {
            const result = await geminiModel.generateContent(prompt);
            text = result.response.text();
        }

        const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const jsonResult = JSON.parse(cleanText) as ConflictResult;
        return jsonResult;

    } catch (e) {
        console.error(`Conflict Checker LLM (${provider}) Failed:`, e);
        return {
            conflict_detected: true,
            reason: "Automatic conflict verification failed. Please check manually.",
            suggestion: "System Error: " + (e as Error).message
        };
    }
}
