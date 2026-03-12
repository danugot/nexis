import { FunctionDeclaration, SchemaType } from '@google/generative-ai';
import OpenAI from "openai";
import * as dotenv from "dotenv";

dotenv.config();

export interface DependencyImpactInput {
    action: 'trace_dependencies' | 'simulate_impact' | 'explain_lineage';
    intent_text: string;       // Unified natural language input from the user
    projectName?: string;
}

export const dependencyImpactAnalyzerDeclaration: FunctionDeclaration = {
    name: "dependency_impact_analyzer",
    description: "MASTER_DEPENDENCY_TOOL: The SINGLE tool for ALL structural and dependency analysis. Use this to trace blast radius of an entity, simulate the impact of a new feature proposal, or explain the historical lineage of a business rule.",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            action: {
                type: SchemaType.STRING,
                description: "The core analysis mode: 'trace_dependencies' (blast radius), 'simulate_impact' (sandbox feasibility), or 'explain_lineage' (historical roots)."
            },
            intent_text: {
                type: SchemaType.STRING,
                description: "The name of the entity, the proposed feature, or the subject you want to analyze or trace."
            },
            projectName: { type: SchemaType.STRING, description: "Optional project scope." }
        },
        required: ["action", "intent_text"]
    }
};

const openai = new OpenAI({
    apiKey: process.env.DASHSCOPE_API_KEY || "sk-dummy",
    baseURL: process.env.OPENAI_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1"
});

const RAG_API_URL = process.env.RAG_API_URL || "http://rag_api:8000";

// --- Shared Helpers ---

async function getProvider(): Promise<string> {
    try {
        const res = await fetch(`${RAG_API_URL}/settings`);
        if (res.ok) {
            const data = await res.json();
            return data.llm_provider || "qwen-plus";
        }
    } catch (e) {
        console.warn("Could not fetch provider, defaulting to qwen-plus");
    }
    return "qwen-plus";
}

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
        return "";
    }
}

async function getGraphContext(entity_name: string, depth: number, projectName?: string): Promise<any> {
    try {
        const url = new URL(`${RAG_API_URL}/graph/trace/${encodeURIComponent(entity_name)}`);
        url.searchParams.append("depth", depth.toString());
        if (projectName) url.searchParams.append("project_name", projectName);

        const response = await fetch(url.toString());
        if (response.ok) {
            return await response.json();
        }
        return { nodes: [], edges: [] };
    } catch (e) {
        return { nodes: [], edges: [] };
    }
}

async function callLLM(prompt: string, provider: string): Promise<any> {
    try {
        const completion = await openai.chat.completions.create({
            model: provider.includes('qwen') ? provider : "qwen-plus",
            messages: [{ role: "user", content: prompt }]
        });
        const text = completion.choices[0].message.content || "";
        const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
        
        try {
            return JSON.parse(cleanText);
        } catch (parseError) {
            // Fallback: try to extract JSON array or object using regex if there's surrounding text
            const match = cleanText.match(/(\{|\[)[\s\S]*(\}|\])/);
            if (match) {
                try {
                    return JSON.parse(match[0]);
                } catch (e2) {}
            }
            // If all parsing fails, return the raw text wrapped in an object so the tool doesn't crash
            console.warn("LLM did not return strict JSON, wrapping raw text.");
            return { rawOutput: text, error: "Failed to parse strict JSON", summary: text };
        }
    } catch (error: any) {
        console.error("LLM Call Failed:", error);
        throw error;
    }
}

// --- Action Implementations ---

async function runTrace(input: DependencyImpactInput, provider: string) {
    if (!input.intent_text) throw new Error("intent_text required for trace_dependencies");

    const subgraph = await getGraphContext(input.intent_text, 2, input.projectName);
    const vector = await queryRAG(`Dependencies, relations, and impact of ${input.intent_text}`, input.projectName, ["EFFECTIVE"]);

    const prompt = `
    You are 'Nexis', a Senior System Architect. Analyze "Blast Radius".
    Target Entity: ${input.intent_text}
    Graph: ${JSON.stringify(subgraph)}
    Textual Context: ${vector}
    
    Provide Impact Analysis and identify direct/indirect dependencies.
    Return JSON: { "summary": "", "direct_dependencies": [], "affected_nodes": [], "impact_analysis": "" }
    `;
    return callLLM(prompt, provider);
}

async function runSimulate(input: DependencyImpactInput, provider: string) {
    if (!input.intent_text) throw new Error("intent_text required for simulate_impact");

    const vector = await queryRAG(input.intent_text, input.projectName, ["EFFECTIVE"]);
    const subgraph = await getGraphContext(input.intent_text, 2, input.projectName);

    const prompt = `
    Run "Feasibility Sandbox Simulation" on new feature.
    Feature: ${input.intent_text}
    Vector Constraints: ${vector}
    Graph Dependencies: ${JSON.stringify(subgraph)}
    
    Check for sequence breaking ("违背既定时序原则").
    Return JSON: { "is_feasible": true, "affected_modules": [], "broken_rules": [], "missing_fields": [], "suggestions": "", "confidence": 0.9 }
    `;
    return callLLM(prompt, provider);
}

async function runLineage(input: DependencyImpactInput, provider: string) {
    if (!input.intent_text) throw new Error("intent_text required for explain_lineage");

    const subgraph = await getGraphContext(input.intent_text, 4, input.projectName);
    const vector = await queryRAG(`${input.intent_text} 的来源、背景、规则、依据、Regulation, Origins`, input.projectName);

    const prompt = `
    Trace Lineage back to origin point.
    Target Entity: ${input.intent_text}
    Graph Context: ${JSON.stringify(subgraph)}
    Textual Evidence: ${vector}
    
    Return JSON: { "summary": "", "origin_point": { "name": "", "type": "", "source": "" }, "lineage_path": [], "business_justification": "", "confidence": 0.9 }
    `;
    return callLLM(prompt, provider);
}

// --- Main Entry ---

export async function dependencyImpactAnalyzer(input: DependencyImpactInput) {
    const provider = await getProvider();

    try {
        switch (input.action) {
            case 'trace_dependencies':
                return await runTrace(input, provider);
            case 'simulate_impact':
                return await runSimulate(input, provider);
            case 'explain_lineage':
                return await runLineage(input, provider);
            default:
                throw new Error(`Unknown action: ${input.action}`);
        }
    } catch (error: any) {
        console.error("Dependency Analyzer Failed:", error);
        return { error: `Dependency Analyzer [${input.action}] failed: ${error.message}` };
    }
}
