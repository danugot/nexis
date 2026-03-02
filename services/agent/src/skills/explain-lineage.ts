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

async function getGraphContext(entityName: string): Promise<string> {
    try {
        // We use a deeper trace for lineage to find roots
        const response = await fetch(`${RAG_API_URL}/graph/trace/${encodeURIComponent(entityName)}?depth=4`);
        if (response.ok) {
            const subgraph = await response.json();
            return JSON.stringify(subgraph);
        }
        return "No graph context found.";
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
    const { entity_name } = input;
    const provider = await getProvider();

    // 1. Get deep graph context to find roots
    const graphContext = await getGraphContext(entity_name);

    const prompt = `
    You are 'Nexis', a Master Business Architect and Domain Historian.
    Your task is to "Trace the Lineage" of a specific business rule or entity back to its ultimate origin point.

    === Target Entity ===
    ${entity_name}

    === Graph Context (Nodes & Relations) ===
    ${graphContext}
    
    === Analysis Instructions ===
    1. Identify the "Root Node" in the subgraph. This is usually a 'Business_Goal', 'Regulation', or 'Policy' node that has no incoming 'derived_from' or 'implements' relations, but many outbound ones.
    2. Map the "Lineage Path": The sequence of entities and relations from the root to the target entity.
    3. Provide a "Business Justification": Explain WHY this rule exists based on the root goal (e.g., "This fee exists to comply with Central Bank Regulation X").
    4. Summarize the lineage clearly for a senior stakeholder.

    Return ONLY valid JSON:
    {
        "summary": "High-level summary of the lineage.",
        "origin_point": {
            "name": "Name of the root goal/regulation",
            "type": "Type of node",
            "source": "Source document if known"
        },
        "lineage_path": ["Root Entity -> Relation -> Intermediate Entity -> Relation -> Target Entity"],
        "business_justification": "Deep explanation of the reasoning lineage."
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
