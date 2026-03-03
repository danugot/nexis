import { GoogleGenerativeAI, FunctionDeclaration, SchemaType } from "@google/generative-ai";
import OpenAI from "openai";
import * as dotenv from "dotenv";

dotenv.config();

export interface CheckComplianceInput {
    requirement_text: string;
    domainId?: string;
    projectName?: string;
    status_filter?: string[];
}

export interface ComplianceReport {
    is_compliant: boolean;
    violations: Array<{
        rule: string;
        explanation: string;
        source: string;
    }>;
    recommendations: string;
}

export const checkComplianceDeclaration: FunctionDeclaration = {
    name: "check_compliance",
    description: "Compliance Check Tool: Validates a requirement against safety policies, security standards, regulatory rules, and global business constraints. Use this specifically when the user asks about 'compliance' (合规性), 'security' (安全性), or 'business norms' (业务规范).",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            requirement_text: {
                type: SchemaType.STRING,
                description: "The requirement text or feature description to validate."
            },
            domainId: {
                type: SchemaType.STRING,
                description: "Optional domain context."
            },
            projectName: {
                type: SchemaType.STRING,
                description: "Optional project context."
            }
        },
        required: ["requirement_text"]
    }
};

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const geminiModel = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

const openai = new OpenAI({
    apiKey: process.env.DASHSCOPE_API_KEY || "sk-dummy",
    baseURL: process.env.OPENAI_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1"
});

const RAG_API_URL = process.env.RAG_API_URL || "http://rag_api:8000";

async function queryRAG(query: string, domainId?: string, projectName?: string, status_filter?: string[]): Promise<string> {
    try {
        const response = await fetch(`${RAG_API_URL}/retrieve`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                query: query,
                n_results: 10,
                domain_id: domainId,
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
        return "No specific structural rules found in graph.";
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

export async function checkCompliance(input: CheckComplianceInput): Promise<ComplianceReport> {
    const { requirement_text, domainId, projectName, status_filter } = input;
    const provider = await getProvider();

    // 1. Retrieve potential global rules (Vector)
    const vectorContext = await queryRAG(`Global business rules security policy compliance standards ${requirement_text}`, domainId, projectName, status_filter);

    // 2. Retrieve structural dependencies (Graph)
    const graphContext = await getGraphContext(requirement_text, projectName);

    const prompt = `
    You are 'Nexis', a Senior Compliance Officer and System Architect.
    Your task is to validate a proposed requirement or feature against the existing "Global Rules" and "Business Patterns".
    Use BOTH document-based rules and Knowledge Graph structures.

    === Proposed Requirement ===
    ${requirement_text}

    === Textual Rules & Standards (Vector) ===
    ${vectorContext || "No specific document rules found."}

    === Structural Relationships (Graph) ===
    ${graphContext}
    
    === Analysis Instructions ===
    1. Identify violations of document-based rules found in the vector context.
    2. Identify conflicts with structural relationships in the graph context.
    3. **CRITICAL: Detect Dependency Inversion & Silent Prerequisites**. 
       - If the user proposes doing Step B before Step A, but the context shows Step A is a prerequisite or MUST happen first (e.g., "提示承兑签收后才能提示收票"), flag this as a critical violation ("时序逻辑违规").
       - BEWARE of "Silent Prerequisites": If a document configures an "Automatic action X", it DOES NOT waive the fundamental legal prerequisites for X unless explicitly stated. Always enforce the core sequential flow found in the context.
    4. For each violation, explain WHY it is a violation and cite the SOURCE.
    5. Provide recommendations for alignment.
    6. Give a Confidence Score (0.0 to 1.0) based on context availability.
    7. IMPORTANT: You MUST output all generated text, explanations, and recommendations entirely in Simplified Chinese (简体中文).

    Return ONLY valid JSON:
    {
        "is_compliant": true/false,
        "violations": [
            {
                "rule": "Short name of the rule violated",
                "explanation": "Detailed explanation of the conflict",
                "source": "Filename or Graph Entity"
            }
        ],
        "recommendations": "How to fix the violations.",
        "confidence": 0.85
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
        return JSON.parse(cleanText) as ComplianceReport;

    } catch (e) {
        console.error("Compliance Check Failed:", e);
        return {
            is_compliant: false,
            violations: [{
                rule: "System Error",
                explanation: (e as Error).message,
                source: "LLM Provider"
            }],
            recommendations: "Please try again later or check system connectivity."
        };
    }
}
