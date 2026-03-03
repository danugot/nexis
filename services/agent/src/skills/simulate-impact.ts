import { GoogleGenerativeAI, FunctionDeclaration, SchemaType } from "@google/generative-ai";
import OpenAI from "openai";
import * as dotenv from "dotenv";

dotenv.config();

export interface SimulateImpactInput {
    proposed_feature: string;
    search_keywords: string;
    projectName?: string;
    status_filter?: string[];
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
    description: "Sandbox Feasibility Tool: Technical analysis of a new feature proposal to identify affected modules, APIs, and missing technical prerequisites. Use this when the user asks about 'feasibility' (实现可能性), 'impact' (影响面), or when proposing a general plan (方案).",
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

async function queryRAG(query: string, projectName?: string, status_filter?: string[]): Promise<string> {
    try {
        const response = await fetch(`${RAG_API_URL}/retrieve`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                query: query,
                n_results: 15,
                project_name: projectName,
                status_filter: status_filter || ["EFFECTIVE"]
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

async function getGraphContext(entity_name: string, projectName?: string): Promise<string> {
    try {
        const url = new URL(`${RAG_API_URL}/graph/trace/${encodeURIComponent(entity_name)}`);
        if (projectName) url.searchParams.append("project_name", projectName);
        const response = await fetch(url.toString());
        if (response.ok) {
            const subgraph = await response.json();
            if (subgraph.nodes && subgraph.nodes.length > 0) {
                return JSON.stringify(subgraph);
            }
        }
        return "No structural dependencies found in graph.";
    } catch (e) {
        return "Graph retrieval failed.";
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

    // 1. Textual impact (Vector)
    const vectorContext = await queryRAG(search_keywords, projectName, input.status_filter);
    // 2. Structural impact (Graph)
    const graphContext = await getGraphContext(search_keywords, projectName);

    const prompt = `
    You are 'Nexis', a Senior Business Architect.
    Your task is to run a "Feasibility Sandbox Simulation" on a newly proposed feature.
    Use BOTH document-based constraints and structural Knowledge Graph relationships.

    === Proposed Feature ===
    ${proposed_feature}

    === Textual Constraints (Vector) ===
    ${vectorContext || "No highly relevant document context found."}

    === Structural Dependencies (Graph) ===
    ${graphContext}
    
    === Analysis Instructions ===
    1. Identify conflicts with existing textual rules or logic patterns.
    2. **CRITICAL: Sequence Checking**. If the proposed feature skips or reverses an established business sequence (e.g. attempting collection before acceptance), add it to "broken_rules" as "违背既定时序原则".
    3. Identify affected modules/entities from the structural graph connections (Blast Radius).
    4. Identify "Broken Rules": Existing logic that would need updating.
    5. Identify "Missing Prerequisites": Fields, APIs, or data that the graph shows are missing.
    6. Evaluate overall feasibility and provide a Confidence Score (0.0 to 1.0). If a core sequence rule is broken, feasibility should generally be false unless explicitly handled.
    7. IMPORTANT: You MUST output all generated text, suggestions, and rule names entirely in Simplified Chinese (简体中文).

    Return ONLY valid JSON:
    {
        "is_feasible": true/false,
        "affected_modules": ["Module A", "Field B"],
        "broken_rules": ["Rule X...", "Conflict with Y"],
        "missing_fields": ["Field Z..."],
        "suggestions": "Detailed guidance on implementation.",
        "confidence": 0.9
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
