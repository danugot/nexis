import { GoogleGenerativeAI } from "@google/generative-ai";
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
}

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

async function queryRAG(query: string): Promise<string> {
    try {
        // Assume RAG Service is running on localhost:8001
        const response = await fetch("http://localhost:8001/retrieve", {
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

export async function checkConflict(input: ConflictInput): Promise<ConflictResult> {
    const { new_requirement, retrieved_context } = input;

    // 1. Fetch Related Context from RAG (Vector DB)
    const ragContext = await queryRAG(new_requirement);

    // 2. Construct Prompt for Senior Architect AI
    const prompt = `
    You are 'Nexis', a Senior Business Analyst and Consistency Guardian.
    Your goal is to identify if the **New Requirement** conflicts with:
    1. The **Current PRD Context**.
    2. **Historical/Related Rules** identified by the memory system.

    === Current PRD Context ===
    ${retrieved_context}

    === Historical/Related Knowledge (RAG) ===
    ${ragContext || "No related historical context found."}

    === Propsoed New Requirement ===
    "${new_requirement}"
    
    === Analysis Instructions ===
    1. **Direct Conflict**: Does the new requirement directly contradict existing rules (e.g., limits, roles)?
    2. **Logical Inconsistency**: Does it break the tier structure (e.g., Level 2 getting more than Level 5)?
    3. **Historical Regression**: Does it revert a previously explicitly set constraint without explanation?
    4. **Heuristic Check**: If numbers are involved, check for suspicious gaps (e.g., Ordinary Limit > 50% of Gold Limit).

    Example of Response JSON:
    {
        "conflict_detected": true,
        "reason": "Direct conflict: User attempted to set Level 2 limit to 8000, but Gold Member (Level 4) is only 5000.",
        "suggestion": "Adjust Level 2 limit to < 2500 OR Raise Gold Member limit."
    }

    Return ONLY valid JSON.
    `;

    try {
        const result = await model.generateContent(prompt);
        const text = result.response.text();

        // Clean markdown code blocks if present
        const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const jsonResult = JSON.parse(cleanText) as ConflictResult;

        return jsonResult;

    } catch (e) {
        console.error("Conflict Checker LLM Failed:", e);
        // Fallback to safe default
        return {
            conflict_detected: true,
            reason: "Automatic conflict verification failed. Please check manually.",
            suggestion: "System Error: " + (e as Error).message
        };
    }
}
