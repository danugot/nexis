import { GoogleGenerativeAI, FunctionDeclaration, SchemaType } from "@google/generative-ai";
import OpenAI from "openai";
import * as dotenv from "dotenv";

dotenv.config();

export interface DetectGapsInput {
    target_area: string;
    projectName?: string;
}

export interface LogicGap {
    area: string;
    description: string;
    missing_elements: string[];
    risk_level: 'High' | 'Medium' | 'Low';
}

export interface GapReport {
    summary: string;
    gaps: LogicGap[];
    suggestions: string;
}

export const detectGapsDeclaration: FunctionDeclaration = {
    name: "detect_gaps",
    description: "Logic Gap Detection Tool: Analyzes a specific business area or feature to identify under-specified rules, 'blank' logic, or missing connections in the knowledge base. Use this when the user asks to 'find gaps' (找逻辑漏洞), 'check for completeness' (检查完整性), or 'analyze blind spots' (分析盲区).",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            target_area: {
                type: SchemaType.STRING,
                description: "The business area or feature name to analyze (e.g., '提现逻辑', '商票背书流程')."
            },
            projectName: {
                type: SchemaType.STRING,
                description: "Optional project scope."
            }
        },
        required: ["target_area"]
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

async function getGraphContext(entityName: string): Promise<string> {
    try {
        const response = await fetch(`${RAG_API_URL}/graph/trace/${encodeURIComponent(entityName)}?depth=2`);
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

export async function detectGaps(input: DetectGapsInput): Promise<GapReport> {
    const { target_area, projectName } = input;
    const provider = await getProvider();

    // 1. Gather deep context
    const vectorContext = await queryRAG(`Detailed business logic, constraints, and error handling for ${target_area}`, projectName);
    const graphContext = await getGraphContext(target_area);

    const prompt = `
    You are 'Nexis', a Master Business Architect and Logic Auditor.
    Your task is to identify "Logic Gaps" or "Blind Spots" in the business requirements for a specific area.

    === Target Area ===
    ${target_area}

    === Retrievied Business Rules ===
    ${vectorContext || "No rules found in knowledge base."}

    === Knowledge Graph Context ===
    ${graphContext}
    
    === Analysis Instructions ===
    1. Look for "Under-specified" areas: Features mentioned but with no details on HOW they work.
    2. Look for "Missing Error Handling": What happens if the process fails or limits are reached?
    3. Look for "Dead Ends": Entities in the graph with no outbound relationships or rules.
    4. Identify "State Gaps": Are all possible status transitions accounted for (e.g., from 'Pending' to 'Finished', is there a 'Failed' state?)?

    Return ONLY valid JSON:
    {
        "summary": "High-level overview of the logic completeness in this area.",
        "gaps": [
            {
                "area": "Sub-component or specific rule",
                "description": "Why this is considered a gap or blind spot",
                "missing_elements": ["Rule for X", "Validation for Y"],
                "risk_level": "High/Medium/Low"
            }
        ],
        "suggestions": "Recommended actions to close these gaps."
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
        return JSON.parse(cleanText) as GapReport;

    } catch (e) {
        console.error("Gap Detection Failed:", e);
        return {
            summary: "Error: Gap detection analysis failed.",
            gaps: [{
                area: "System",
                description: "Failed to perform analysis.",
                missing_elements: [(e as Error).message],
                risk_level: "High"
            }],
            suggestions: "Please check system logs and try again."
        };
    }
}
