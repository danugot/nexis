import { GoogleGenerativeAI, FunctionDeclaration, SchemaType } from "@google/generative-ai";
import OpenAI from "openai";
import * as dotenv from "dotenv";

dotenv.config();

export interface ExplainLineageInput {
    entity_name: string;
    projectName?: string;
}

export interface LineageReport {
    summary: string;
    origin_point: {
        name: string;
        type: string;
        source: string;
    };
    lineage_path: string[];
    business_justification: string;
}

export const explainLineageDeclaration: FunctionDeclaration = {
    name: "explain_lineage",
    description: "Lineage Analysis Tool: Traces a specific business rule or requirement back to its original source, such as a high-level business goal, regulatory requirement, or architectural decision. Use this when the user asks 'where did this rule come from?' (这条规则哪来的), 'why do we have this?' (为什么要这样做), or asks for 'lineage' (溯源).",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            entity_name: {
                type: SchemaType.STRING,
                description: "The name of the rule or concept to trace back (e.g., '手续费比例', '实名认证要求')."
            },
            projectName: {
                type: SchemaType.STRING,
                description: "Optional project context."
            }
        },
        required: ["entity_name"]
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
                n_results: 10,
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

async function getGraphContext(entityName: string): Promise<string> {
    try {
        // We use a deeper trace for lineage to find roots
        const response = await fetch(`${RAG_API_URL}/graph/trace/${encodeURIComponent(entityName)}?depth=4`);
        if (response.ok) {
            const subgraph = await response.json();
            if (subgraph.nodes && subgraph.nodes.length > 0) {
                return JSON.stringify(subgraph);
            }
        }
        return "No specific graph relationships found.";
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

export async function explainLineage(input: ExplainLineageInput): Promise<LineageReport> {
    const { entity_name, projectName } = input;
    const provider = await getProvider();

    console.log(`[Lineage] Analyzing entity: ${entity_name}`);

    // 1. Get deep graph context to find roots
    const graphContext = await getGraphContext(entity_name);
    // 2. Get vector context to find textual evidence - broaden search
    const vectorContext = await queryRAG(`${entity_name} 的来源、背景、规则、依据、Regulation, Origins`, projectName);

    console.log(`[Lineage] Analyzing: ${entity_name}`);
    console.log(`[Lineage] Graph Context found nodes: ${graphContext.length > 50 ? 'Yes' : 'No'}`);
    console.log(`[Lineage] Vector Context found results: ${vectorContext.length > 50 ? 'Yes' : 'No'}`);

    const prompt = `
    You are 'Nexis', a Master Business Architect and Domain Historian.
    Your task is to "Trace the Lineage" of a specific business rule or entity back to its ultimate origin point using the provided Knowledge Base context.

    === Target Entity ===
    ${entity_name}

    === Graph Context (Nodes & Relations) ===
    ${graphContext}

    === Textual Evidence (Vector Search) ===
    ${vectorContext || "No direct textual evidence found."}
    
    === Analysis Instructions ===
    1. STRICT RULE: You MUST base your analysis ONLY on the provided Graph Context and Textual Evidence.
    2. Identify the "Root Goal" or "Source Document Clause".
    3. If multiple sources exist, summarize them clearly.
    4. Provide a "Confidence Score" for this lineage trace (0.0 to 1.0).
    5. If NO evidence of origin is found in the provided context, clearly state that the lineage is UNKNOWN in the knowledge base. DO NOT HALLUCINATE OR USE INTERNAL KNOWLEDGE.

    Return ONLY valid JSON:
    {
        "summary": "High-level summary of the lineage.",
        "origin_point": {
            "name": "Name of the root goal/regulation or 'Unknown'",
            "type": "Type of node or source",
            "source": "Source document if known"
        },
        "lineage_path": ["Detailed steps from root to the entity"],
        "business_justification": "Why this rule exists based on the retrieved context.",
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
        return JSON.parse(cleanText) as LineageReport;

    } catch (e) {
        console.error("Lineage Analysis Failed:", e);
        return {
            summary: "Error: Lineage analysis failed.",
            origin_point: { name: "Unknown", type: "System Error", source: "N/A" },
            lineage_path: [],
            business_justification: (e as Error).message
        };
    }
}
