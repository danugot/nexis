import { GoogleGenerativeAI, FunctionDeclaration, SchemaType } from "@google/generative-ai";
import OpenAI from "openai";
import * as dotenv from "dotenv";

dotenv.config();

export interface CompareRequirementsInput {
    projectName?: string;
    versionA?: string;
    versionB?: string;
    docIdA?: string;
    docIdB?: string;
    filenameA?: string;
    filenameB?: string;
}

export interface ComparisonReport {
    summary: string;
    added_logic: string[];
    removed_logic: string[];
    modified_logic: string[];
    risk_assessment: string;
}

export const compareRequirementsDeclaration: FunctionDeclaration = {
    name: "compare_requirements",
    description: "Requirement Comparison Tool: Compares two requirements documents to find logical differences. Supports comparing two versions of the same project OR two completely different requirements documents.",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            projectName: {
                type: SchemaType.STRING,
                description: "The name of the project (if comparing versions)."
            },
            versionA: {
                type: SchemaType.STRING,
                description: "Baseline version (e.g., 'v1.0')."
            },
            versionB: {
                type: SchemaType.STRING,
                description: "Target version (e.g., 'v1.1')."
            },
            docIdA: {
                type: SchemaType.STRING,
                description: "ID of the baseline document (if comparing arbitrary docs)."
            },
            docIdB: {
                type: SchemaType.STRING,
                description: "ID of the target document (if comparing arbitrary docs)."
            },
            filenameA: {
                type: SchemaType.STRING,
                description: "Filename of the baseline document."
            },
            filenameB: {
                type: SchemaType.STRING,
                description: "Filename of the target document."
            }
        },
        required: []
    }
};

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const geminiModel = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

const openai = new OpenAI({
    apiKey: process.env.DASHSCOPE_API_KEY || "sk-dummy",
    baseURL: process.env.OPENAI_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1"
});

const RAG_API_URL = process.env.RAG_API_URL || "http://rag_api:8000";

async function getGraphContext(filename: string): Promise<string> {
    try {
        const response = await fetch(`${RAG_API_URL}/graph/visualize?search_query=${encodeURIComponent(filename)}&limit=50`);
        if (response.ok) {
            const data = await response.json();
            if (data.nodes && data.nodes.length > 0) {
                return JSON.stringify(data);
            }
        }
        return "No graph context for this document.";
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

async function getDocumentDetails(input: { id?: string; filename?: string; project?: string; version?: string }): Promise<{ content: string; filename: string }> {
    try {
        let docId = input.id;
        let filename = input.filename || "";

        if (!docId && input.project && input.version) {
            const res = await fetch(`${RAG_API_URL}/projects/${encodeURIComponent(input.project)}/versions`);
            if (res.ok) {
                const versions = await res.json();
                const doc = versions.find((v: any) => v.version.toLowerCase() === input.version?.toLowerCase());
                if (doc) {
                    docId = doc.id;
                    filename = doc.filename;
                }
            }
        }

        if (!docId && input.filename) {
            const res = await fetch(`${RAG_API_URL}/documents`);
            if (res.ok) {
                const docs = await res.json();
                const doc = docs.find((d: any) => d.filename === input.filename);
                if (doc) {
                    docId = doc.id;
                    filename = doc.filename;
                }
            }
        }

        if (!docId) return { content: "", filename: "" };

        const contentRes = await fetch(`${RAG_API_URL}/documents/${docId}/content`);
        if (!contentRes.ok) return { content: "", filename: "" };
        const contentData = await contentRes.json();
        return { content: contentData.content || "", filename };
    } catch (e) {
        console.error("Failed to fetch document content:", e);
        return { content: "", filename: "" };
    }
}

export async function compareRequirements(input: CompareRequirementsInput): Promise<ComparisonReport> {
    const provider = await getProvider();

    const docA = await getDocumentDetails({
        id: input.docIdA,
        filename: input.filenameA,
        project: input.projectName,
        version: input.versionA
    });
    const docB = await getDocumentDetails({
        id: input.docIdB,
        filename: input.filenameB,
        project: input.projectName,
        version: input.versionB
    });

    if (!docA.content || !docB.content) {
        return {
            summary: "Error: Could not retrieve content for one or both requirements.",
            added_logic: [],
            removed_logic: [],
            modified_logic: [],
            risk_assessment: "Data retrieval failed."
        };
    }

    // 2. Fetch Graph subgraphs for structural comparison
    const graphA = await getGraphContext(docA.filename);
    const graphB = await getGraphContext(docB.filename);

    const prompt = `
    You are 'Nexis', a Senior Business Architect.
    Your task is to analyze the LOGICAL and STRUCTURAL DIFFERENCES between two requirements documents.
    Use BOTH the Markdown text and the Graph structures.
    
    === Baseline Requirement (A) ===
    Markdown Content (Sample):
    ${docA.content.substring(0, 8000)}
    Knowledge Graph Context:
    ${graphA}

    === Target Requirement (B) ===
    Markdown Content (Sample):
    ${docB.content.substring(0, 8000)}
    Knowledge Graph Context:
    ${graphB}
    
    === Analysis Instructions ===
    1. Identify logical changes in business rules, constraints, and flows from the text.
    2. Identify structural changes in entities and relationships from the graphs (e.g., "Entity X now connects to Y instead of Z").
    3. Synthesize the findings into a clear comparison report.
    4. Assess risks: Does the change break established patterns or introduce complexity?

    Return ONLY valid JSON:
    {
        "summary": "Overall narrative of differences.",
        "added_logic": ["New Entity X...", "Relation Y added..."],
        "removed_logic": ["Constraint Z removed..."],
        "modified_logic": ["Change A to B"],
        "risk_assessment": "Analysis of potential issues."
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
        return JSON.parse(cleanText) as ComparisonReport;
    } catch (e) {
        console.error("Comparison Tool Failed:", e);
        return {
            summary: "Error: AI analysis failed.",
            added_logic: [],
            removed_logic: [],
            modified_logic: [],
            risk_assessment: "System Error: " + (e as Error).message
        };
    }
}
