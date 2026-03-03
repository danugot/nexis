import { GoogleGenerativeAI, FunctionDeclaration, SchemaType } from "@google/generative-ai";
import OpenAI from "openai";
import * as dotenv from "dotenv";
import { saveReport } from "../utils/persistence";

dotenv.config();

export interface GenerateTestsInput {
    feature_name: string;
    projectName?: string;
    format?: 'gherkin' | 'markdown' | 'json';
}

export interface TestCase {
    title: string;
    scenario: string;
    steps: string[];
    expected_result: string;
}

export interface TestReport {
    summary: string;
    test_cases: TestCase[];
}

export const generateTestsDeclaration: FunctionDeclaration = {
    name: "generate_tests",
    description: "Test Generation Tool: Automatically generates structured UAT (User Acceptance Test) scenarios and BDD test cases from the business logic and graph relationships stored in the knowledge base. Use this when the user asks to 'generate tests' (生成测试) or 'UAT scenarios' (验收场景).",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            feature_name: {
                type: SchemaType.STRING,
                description: "The name of the feature or business process to test (e.g., '提现流程', '匿名出质')."
            },
            projectName: {
                type: SchemaType.STRING,
                description: "Optional project context."
            },
            format: {
                type: SchemaType.STRING,
                description: "The output format (default is markdown)."
            }
        },
        required: ["feature_name"]
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

async function getGraphContext(entityName: string, projectName?: string): Promise<string> {
    try {
        const url = new URL(`${RAG_API_URL}/graph/trace/${encodeURIComponent(entityName)}`);
        if (projectName) url.searchParams.append("project_name", projectName);
        const response = await fetch(url.toString());
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

export async function generateTests(input: GenerateTestsInput): Promise<TestReport> {
    const { feature_name, projectName } = input;
    const provider = await getProvider();

    // 1. Gather context from Vector and Graph
    const vectorContext = await queryRAG(`Business rules and flow for ${feature_name}`, projectName);
    const graphContext = await getGraphContext(feature_name, projectName);

    const prompt = `
    You are 'Nexis', a Senior QA Architect and Business Analyst.
    Your task is to generate comprehensive UAT (User Acceptance Test) scenarios for a specific feature based on retrieved business logic.

    === Target Feature ===
    ${feature_name}

    === Business Rules (Vector Context) ===
    ${vectorContext || "No specific rules found. Use general best practices."}

    === Relationship Context (Graph Subgraph) ===
    ${graphContext}
    
    === Instructions ===
    1. Analyze the business rules and constraints.
    2. Generate at least 3-5 high-quality test scenarios.
    3. Include both "Happy Path" and "Edge Cases" (e.g., limit violations, permission errors).
    4. Use BDD (Given/When/Then) format for the scenario descriptions.

    Return ONLY valid JSON:
    {
        "summary": "High-level test strategy for this feature.",
        "test_cases": [
            {
                "title": "Clear test case title",
                "scenario": "Given... When... Then...",
                "steps": ["Step 1", "Step 2"],
                "expected_result": "Direct outcome"
            }
        ]
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
        const report = JSON.parse(cleanText) as TestReport;

        let markdownCases = `# Test Scenarios: ${feature_name}\n\n**Summary:** ${report.summary}\n\n`;
        report.test_cases.forEach((tc, index) => {
            markdownCases += `## ${index + 1}. ${tc.title}\n`;
            markdownCases += `**Scenario:** ${tc.scenario}\n`;
            markdownCases += `**Steps:**\n`;
            tc.steps.forEach(step => markdownCases += `- ${step}\n`);
            markdownCases += `**Expected:** ${tc.expected_result}\n\n`;
        });

        const savedPath = saveReport('TestCases', markdownCases, projectName);

        return {
            ...report,
            test_markdown: markdownCases,
            saved_path: savedPath
        } as any; // Cast because TestReport interface doesn't have saved_path yet

    } catch (e) {
        console.error("Test Generation Failed:", e);
        return {
            summary: "Error: Test generation failed.",
            test_cases: []
        };
    }
}
