import { FunctionDeclaration, SchemaType } from '@google/generative-ai';
import OpenAI from "openai";
import * as dotenv from "dotenv";

dotenv.config();

export interface RequirementAnalyzerInput {
    action: 'analyze' | 'compare' | 'check_conflict' | 'detect_gaps' | 'check_compliance';
    intent_text?: string;
    documentId?: string;
    projectName?: string;
    target_area?: string;          // For gaps/conflicts
    requirement_text?: string;     // For compliance/conflicts
    versionA?: string;             // For compare
    versionB?: string;             // For compare
    docIdA?: string;               // For compare
    docIdB?: string;               // For compare
}

export const requirementAnalyzerDeclaration: FunctionDeclaration = {
    name: "requirement_analyzer",
    description: "Architectural Analysis Tool. Use this when the user explicitly asks to analyze architecture, detect gaps, compare documents, or check business compliance.",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            action: {
                type: SchemaType.STRING,
                description: "The analysis mode: 'analyze', 'compare', 'check_conflict', 'detect_gaps', 'check_compliance'."
            },
            intent_text: {
                type: SchemaType.STRING,
                description: "The natural language description of what the user wants to analyze, compare, or the feature they are proposing."
            }
        },
        required: ["action", "intent_text"]
    }
};

const openai = new OpenAI({
    apiKey: process.env.DASHSCOPE_API_KEY || "sk-dummy",
    baseURL: process.env.OPENAI_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1"
});

const RAG_API_URL = process.env.RAG_API_URL || "http://rag_api:8000";

// --- Shared Helper Functions ---

async function getProvider(): Promise<string> {
    try {
        const res = await fetch(`${RAG_API_URL}/settings`);
        if (res.ok) {
            const data = await res.json();
            return data.llm_provider || "qwen-plus"; // Defaulting to Qwen for better Chinese
        }
    } catch (e) {
        console.warn("Could not fetch provider, defaulting to qwen-plus");
    }
    return "qwen-plus";
}

async function queryRAG(query: string, projectName?: string, n_results: number = 10): Promise<string> {
    try {
        const response = await fetch(`${RAG_API_URL}/retrieve`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                query: query,
                n_results: n_results,
                project_name: projectName,
                status_filter: ["EFFECTIVE", "DRAFT"]
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

async function getGraphContext(entityName: string, projectName?: string): Promise<string> {
    try {
        const url = new URL(`${RAG_API_URL}/graph/trace/${encodeURIComponent(entityName)}`);
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

async function getDocumentDetails(input: { id?: string; filename?: string; project?: string; version?: string }): Promise<{ content: string; filename: string }> {
    try {
        let docId = input.id;
        let filename = input.filename || "";

        if (!docId && input.project && input.version) {
            const res = await fetch(`${RAG_API_URL}/projects/${encodeURIComponent(input.project)}/versions`);
            if (res.ok) {
                const versions = await res.json();
                const doc = versions.find((v: any) => v.version.toLowerCase() === input.version?.toLowerCase());
                if (doc) { docId = doc.id; filename = doc.filename; }
            }
        }

        if (!docId) return { content: "", filename: "" };

        const contentRes = await fetch(`${RAG_API_URL}/documents/${docId}/content`);
        if (!contentRes.ok) return { content: "", filename: "" };
        const contentData = await contentRes.json();
        return { content: contentData.content || "", filename };
    } catch (e) {
        return { content: "", filename: "" };
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
            return { rawOutput: text, error: "Failed to parse JSON", verdict: "ANALYZED", "summary": text };
        }
    } catch (error: any) {
        console.error("LLM Call Failed:", error);
        throw error;
    }
}

// --- Action Implementations ---

async function runAnalyze(input: RequirementAnalyzerInput, provider: string) {
    const text = input.intent_text || input.requirement_text || "";
    const doc = await getDocumentDetails({ id: input.documentId, project: input.projectName });
    const graph = await getGraphContext(input.projectName || "Unknown", input.projectName);
    const vector = await queryRAG(`Architecture rules compliance gaps ${input.projectName} ${text}`, input.projectName, 20);

    const prompt = `
    You are 'Nexis', a Master Business Architect. Perform a comprehensive Architectural Audit on this topic/requirement: ${text}
    Project: ${input.projectName}
    
    Document Content: ${doc.content ? doc.content.substring(0, 5000) : "No full document content provided."}
    Knowledge Graph Context: ${graph}
    Vector Rules Context: ${vector}
    
    Return ONLY JSON with this exact structure:
    {
       "summary": "Overall analysis",
       "compliance": { "is_compliant": true, "violations": [] },
       "dependencies": { "critical_paths": [] },
       "gaps": { "missing_logic": [] }
    }
    `;

    const result = await callLLM(prompt, provider);
    return { ...result, type: 'architect_report', projectName: input.projectName };
}

async function runCompare(input: RequirementAnalyzerInput, provider: string) {
    const docA = await getDocumentDetails({ id: input.docIdA, project: input.projectName, version: input.versionA });
    const docB = await getDocumentDetails({ id: input.docIdB, project: input.projectName, version: input.versionB });
    const graphA = await getGraphContext(docA.filename);
    const graphB = await getGraphContext(docB.filename);

    const prompt = `
    Analyze logical/structural differences between Baseline (A) and Target (B).
    Doc A Content: ${docA.content.substring(0, 4000)}
    Doc B Content: ${docB.content.substring(0, 4000)}
    
    Return JSON: { "summary": "", "added_logic": [], "removed_logic": [], "modified_logic": [], "risk_assessment": "" }
    `;
    return callLLM(prompt, provider);
}

async function runCompliance(input: RequirementAnalyzerInput, provider: string) {
    const text = input.intent_text || input.requirement_text || input.target_area || "";
    const vector = await queryRAG(`Rules compliance ${text}`, input.projectName);
    const graph = await getGraphContext(text, input.projectName);

    const prompt = `
    Validate compliance of the following requirement against rules:
    Requirement: ${text}
    Vector Rules: ${vector}
    Graph Context: ${graph}
    
    Return JSON: { "is_compliant": boolean, "violations": [{ "rule": "", "explanation": "", "source": "" }], "recommendations": "" }
    `;
    return callLLM(prompt, provider);
}

async function runGaps(input: RequirementAnalyzerInput, provider: string) {
    const text = input.intent_text || input.target_area || input.requirement_text || "";
    const vector = await queryRAG(`Details constraints error limits ${text}`, input.projectName);
    const graph = await getGraphContext(text, input.projectName);

    const prompt = `
    Identify missing logic, edge cases, and empty states based on this requirement:
    Target Area: ${text}
    Vector Rules: ${vector}
    Graph Context: ${graph}
    
    Return JSON: { "summary": "", "gaps": [{ "area": "", "description": "", "missing_elements": [], "risk_level": "High/Medium/Low" }], "suggestions": "" }
    `;
    return callLLM(prompt, provider);
}

async function runConflict(input: RequirementAnalyzerInput, provider: string) {
    const text = input.intent_text || input.requirement_text || "";
    const vector = await queryRAG(text, input.projectName);

    const prompt = `
    Identify direct contradictions between the new requirement and historical facts.
    New Requirement: ${text}
    Historical Context: ${vector}
    
    Return JSON: { "conflict_detected": boolean, "reason": "", "suggestion": "", "new_context_snippet": "", "old_context_snippet": "" }
    `;
    return callLLM(prompt, provider);
}

// --- Main Entry Point ---

export async function requirementAnalyzer(input: RequirementAnalyzerInput, domainId?: string, emitEvent?: (event: any) => void) {
    const provider = await getProvider();

    if (emitEvent) {
        emitEvent({ type: 'audit_progress', step: 'init', message: `Starting Requirement Analyzer [${input.action}] for: ${input.projectName}` });
    }

    try {
        switch (input.action) {
            case 'analyze':
                return await runAnalyze(input, provider);
            case 'compare':
                return await runCompare(input, provider);
            case 'check_compliance':
                return await runCompliance(input, provider);
            case 'detect_gaps':
                return await runGaps(input, provider);
            case 'check_conflict':
                return await runConflict(input, provider);
            default:
                throw new Error(`Unknown action: ${input.action}`);
        }
    } catch (error: any) {
        console.error("Requirement Analyzer Failed:", error);
        return { error: `Requirement Analyzer [${input.action}] failed: ${error.message}` };
    }
}
