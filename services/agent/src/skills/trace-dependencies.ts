import { GoogleGenerativeAI, FunctionDeclaration, SchemaType } from "@google/generative-ai";
import OpenAI from "openai";
import * as dotenv from "dotenv";

dotenv.config();

export interface TraceDependenciesInput {
    entity_name: string;
    depth?: number;
    projectName?: string;
    domainId?: string;
    status_filter?: string[];
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
            },
            projectName: {
                type: SchemaType.STRING,
                description: "Optional project name to scope the dependency search."
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

async function queryRAG(query: string, projectName?: string, status_filter?: string[]): Promise<string> {
    try {
        const response = await fetch(`${RAG_API_URL}/retrieve`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                query: query,
                n_results: 10,
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
    // Note: TraceDependenciesInput doesn't have projectName yet, we should add it or handle it optionally
    const projectName = (input as any).projectName;
    const provider = await getProvider();

    try {
        // 1. Get structural dependencies from Graph
        const graphUrl = new URL(`${RAG_API_URL}/graph/trace/${encodeURIComponent(entity_name)}`);
        graphUrl.searchParams.append("depth", depth.toString());
        if (projectName) graphUrl.searchParams.append("project_name", projectName);

        const response = await fetch(graphUrl.toString());
        if (!response.ok) {
            throw new Error(`RAG API returned ${response.status}`);
        }
        const subgraph = await response.json();

        // 2. Get textual dependencies from Vector
        const vectorContext = await queryRAG(`Dependencies, relations, and impact of ${entity_name}`, projectName, input.status_filter);

        if ((!subgraph.nodes || subgraph.nodes.length === 0) && !vectorContext) {
            return {
                summary: `No dependencies found for entity: ${entity_name} in either graph or text.`,
                direct_dependencies: [],
                affected_nodes: [],
                impact_analysis: "The entity appears to be isolated."
            };
        }

        const prompt = `
        You are 'Nexis', a Senior System Architect.
        Your task is to analyze a "Blast Radius" using both Graph relationships and Textual documentation.
        Explain the dependencies of the target entity.

        === Target Entity ===
        ${entity_name}

        === Graph Subgraph (Structured Relations) ===
        Nodes: ${JSON.stringify(subgraph.nodes)}
        Edges: ${JSON.stringify(subgraph.edges)}

        === Textual Context (Unstructured Evidence) ===
        ${vectorContext || "No specific mentions found in documents."}
        
        === Analysis Instructions ===
        1. Identify direct/indirect dependencies from BOTH graph edges and textual mentions.
        2. Identify "Hidden Dependencies": Things mentioned in text but not yet modeled in the graph.
        3. Provide an Impact Analysis: If this entity's logic were to change, which other parts of the system are most at risk?
        4. Synthesize the findings into a clear, professional summary.
        5. IMPORTANT: You MUST output all generated text, summaries, and descriptions entirely in Simplified Chinese (简体中文).

        Return ONLY valid JSON:
        {
            "summary": "Clear explanation of the entity's role and its connections.",
            "direct_dependencies": ["Node A (Relation X)", "Mentioned in Source Y..."],
            "affected_nodes": ["Node C", "Module D"],
            "impact_analysis": "Detailed breakdown of the potential 'Blast Radius'."
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
        return JSON.parse(cleanText) as TraceReport;

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
