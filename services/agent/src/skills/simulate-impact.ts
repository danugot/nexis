import { GoogleGenerativeAI, FunctionDeclaration, SchemaType } from "@google/generative-ai";
import OpenAI from "openai";
import * as dotenv from "dotenv";

dotenv.config();

export interface SimulateImpactInput {
    proposed_feature: string;
    search_keywords: string;
    projectName?: string;
}

export interface ImpactReport {
    is_feasible: boolean;
    affected_modules: string[];
    broken_rules: string[];
    missing_fields: string[];
    suggestions: string;
}

export const simulateImpactDeclaration: FunctionDeclaration = {
    name: "simulate_impact",
    description: "Sandbox Feasibility Tool: Analyzes a Product Manager's proposed new feature, process change, or 'what if' scenario against the existing Knowledge Base (Vector + Graph) to identify affected modules, broken rules, and missing fields. ALWAYS use this when the user asks if something 'can be realized' (可以实现吗), proposes a new idea, or asks for a PRD.",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            proposed_feature: {
                type: SchemaType.STRING,
                description: "The core new feature or business rule being proposed."
            },
            search_keywords: {
                type: SchemaType.STRING,
                description: "Highly specific entities/nouns/verbs extracted from the proposal to search the database (e.g. '商票', '担保人')."
            },
            projectName: {
                type: SchemaType.STRING,
                description: "Optional project scope from the user."
            }
        },
        required: ["proposed_feature", "search_keywords"]
    }
};

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const geminiModel = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

const openai = new OpenAI({
    apiKey: process.env.DASHSCOPE_API_KEY || "sk-dummy",
    baseURL: process.env.OPENAI_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1"
});

const RAG_API_URL = process.env.RAG_API_URL || "http://rag_api:8000";

async function queryRAG(query: string, projectName?: string): Promise<string> {
    try {
        const response = await fetch(`${RAG_API_URL}/retrieve`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                query: query,
                n_results: 15,
                project_name: projectName
            })
        });

        if (response.ok) {
            const data = await response.json();
            if (data.context && Array.isArray(data.context)) {
                return data.context.map((item: any) =>
                    `[${item.type.toUpperCase()}] (${item.source}): ${item.content}`
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
        const res = await fetch(`${RAG_API_URL}/settings`);
        if (res.ok) {
            const data = await res.json();
            return data.llm_provider || "gemini";
        }
    } catch (e) {
        console.warn("Could not fetch provider, defaulting to gemini");
    }
    return "gemini";
}

export async function simulateImpact(input: SimulateImpactInput): Promise<ImpactReport> {
    const { proposed_feature, search_keywords, projectName } = input;
    const provider = await getProvider();

    const ragContext = await queryRAG(search_keywords, projectName);

    const prompt = `
    You are 'Nexis', a Senior Business Architect.
    Your task is to run a "Feasibility Sandbox Simulation" on a newly proposed feature.

    === Proposed Feature ===
    ${proposed_feature}

    === Current System Context (from Knowledge Base) ===
    ${ragContext || "No highly relevant context found."}
    
    === Analysis Instructions ===
    1. Analyze the context to see if the proposed feature conflicts with existing hard rules or dependencies.
    2. Identify which UI modules, APIs, or data models will likely need to be modified (Affected Modules).
    3. Identify any existing rules that would be broken or need updating (Broken Rules).
    4. Identify any missing data fields or prerequisites required for the new feature (Missing Fields).
    5. Evaluate overall feasibility and provide suggestions for architectural refactoring.

    Return ONLY valid JSON matching this schema:
    {
        "is_feasible": true/false,
        "affected_modules": ["Module A", "Page B"],
        "broken_rules": ["Rule 1 prevents X", "Rule 2 requires Y"],
        "missing_fields": ["Field Z on Table W"],
        "suggestions": "Detailed suggestions on how to safely implement this feature without breaking the system."
    }
    `;

    try {
        let text = "";

        if (provider.includes("qwen") || provider.includes("gpt")) {
            const completion = await openai.chat.completions.create({
                model: provider,
                messages: [{ role: "user", content: prompt }]
            });
            text = completion.choices[0].message.content || "";
        } else {
            const result = await geminiModel.generateContent(prompt);
            text = result.response.text();
        }

        const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const jsonResult = JSON.parse(cleanText) as ImpactReport;
        return jsonResult;

    } catch (e) {
        console.error("Simulation Checker LLM (" + provider + ") Failed:", e);
        return {
            is_feasible: false,
            affected_modules: [],
            broken_rules: [],
            missing_fields: [],
            suggestions: "System Error: " + (e as Error).message
        };
    }
}
