import { GoogleGenerativeAI, FunctionDeclaration, SchemaType } from "@google/generative-ai";
import OpenAI from "openai";
import * as dotenv from "dotenv";

dotenv.config();

export interface TraceDependenciesInput {
    entity_name: string;
    depth?: number;
}

export interface TraceReport {
    summary: string;
    direct_dependencies: string[];
    affected_nodes: string[];
    impact_analysis: string;
}

export const traceDependenciesDeclaration: FunctionDeclaration = {
    name: "trace_dependencies",
    description: "Dependency Tracing Tool: Performs a 'Blast Radius' analysis on a business concept or entity. It follows graph relationships to identify all upstream and downstream dependencies that might be affected by a change to this entity.",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            entity_name: {
                type: SchemaType.STRING,
                description: "The name of the entity or concept to trace (e.g., '用户等级', '手续费')."
            },
            depth: {
                type: SchemaType.NUMBER,
                description: "The depth of the relationship traversal (default is 2)."
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

export async function traceDependencies(input: TraceDependenciesInput): Promise<TraceReport> {
    const { entity_name, depth = 2 } = input;
    const provider = await getProvider();

    try {
        const response = await fetch(`${RAG_API_URL}/graph/trace/${encodeURIComponent(entity_name)}?depth=${depth}`);
        if (!response.ok) {
            throw new Error(`RAG API returned ${response.status}`);
        }
        const subgraph = await response.json();

        if (!subgraph.nodes || subgraph.nodes.length === 0) {
            return {
                summary: `No dependencies found for entity: ${entity_name}`,
                direct_dependencies: [],
                affected_nodes: [],
                impact_analysis: "The entity appears to be isolated in the current knowledge graph."
            };
        }

        const prompt = `
        You are 'Nexis', a Senior System Architect.
        Your task is to analyze a "Blast Radius" subgraph and explain the dependencies of a specific entity.

        === Target Entity ===
        ${entity_name}

        === Graph Subgraph (Nodes & Edges) ===
        Nodes: ${JSON.stringify(subgraph.nodes)}
        Edges: ${JSON.stringify(subgraph.edges)}
        
        === Analysis Instructions ===
        1. Identify direct dependencies (nodes directly connected to the target).
        2. Identify indirect dependencies (nodes connected via 2+ hops).
        3. Provide an Impact Analysis: If this entity's logic were to change, which other parts of the system are most at risk?
        4. Synthesize the findings into a clear, professional summary.

        Return ONLY valid JSON matching this schema:
        {
            "summary": "Clear explanation of the entity's role and its primary connections.",
            "direct_dependencies": ["Node A (Relation X)", "Node B (Relation Y)"],
            "affected_nodes": ["Node C", "Node D"],
            "impact_analysis": "Detailed breakdown of the potential 'Blast Radius' if this entity is modified."
        }
        `;

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
        const jsonResult = JSON.parse(cleanText) as TraceReport;
        return jsonResult;

    } catch (e) {
        console.error("Trace Tool Failed:", e);
        return {
            summary: "Error: Dependency tracing failed.",
            direct_dependencies: [],
            affected_nodes: [],
            impact_analysis: "System Error: " + (e as Error).message
        };
    }
}
