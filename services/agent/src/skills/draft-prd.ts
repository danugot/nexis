import { GoogleGenerativeAI, FunctionDeclaration, SchemaType } from "@google/generative-ai";
import OpenAI from "openai";
import * as dotenv from "dotenv";
import { simulateImpact } from "./simulate-impact";
import { saveReport } from "../utils/persistence";

dotenv.config();

export interface DraftPrdInput {
    proposal: string;
    impact_report?: any; // the JSON report from simulate_impact
    projectName?: string;
}

export interface DraftPrdResult {
    prd_markdown: string;
    saved_path?: string;
}

export const draftPrdDeclaration: FunctionDeclaration = {
    name: "draft_prd",
    description: "Generates a fully-formatted, detailed Draft PRD (Product Requirements Document) based on the user's initial proposal and the feasibility Sandbox Impact Report. ALWAYS use this AFTER running simulate_impact.",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            proposal: {
                type: SchemaType.STRING,
                description: "The original feature proposal."
            }
        },
        required: ["proposal"]
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

export async function draftPrd(input: DraftPrdInput): Promise<DraftPrdResult> {
    let { proposal, impact_report } = input;
    if (!impact_report) {
        impact_report = await simulateImpact({ proposed_feature: proposal, search_keywords: proposal });
    }
    const provider = await getProvider();

    const prompt = `
    You are 'Nexis', a Senior Business Architect and Product Manager.
    Your task is to take a PM's raw idea and the automated System Impact Report, and generate a highly structured, professional Draft PRD in GitHub-flavored Markdown.

    === Proposal ===
    ${proposal}

    === Sandbox Impact Report ===
    ${typeof impact_report === 'string' ? impact_report : JSON.stringify(impact_report, null, 2)}
    
    === PRD Generation Instructions ===
    Generate a complete PRD in SIMPLIFIED CHINESE (简体中文) following this exact structure:
    # 📝 [Auto-generate an elegant title in Chinese]
    
    ## 1. 背景与目标 (Background & Objective)
    [Explain the business intent behind the proposal in Chinese]
    
    ## 2. 可行性与风险评估 (Feasibility & Risk Assessment)
    [Summarize the is_feasible flag, and document the broken_rules and suggestions from the impact report in Chinese. Call out high risks.]
    
    ## 3. 影响的系统模块 (Affected System Modules)
    [List the affected_modules in Chinese. Use bullet points.]
    
    ## 4. 数据与接口变更需求 (Required Data/Field Changes)
    [List the missing_fields that need to be added to the database or API interfaces in Chinese.]
    
    ## 5. 功能需求详情 (Functional Requirements)
    [Draft detailed, step-by-step business rules and system behaviors required to implement the proposal in Chinese. Be explicit.]
    
    Output ONLY the markdown content. Do not wrap in JSON or add any conversational prefixes.
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

        const prdContent = text.trim().replace(/^```markdown/g, '').replace(/```$/g, '').trim();
        const savedPath = saveReport('DraftPRD', prdContent, input.projectName);

        return {
            prd_markdown: prdContent,
            saved_path: savedPath
        };

    } catch (e) {
        console.error("PRD Drafter LLM (" + provider + ") Failed:", e);
        return {
            prd_markdown: "# Error Generating PRD\nInternal system error: " + (e as Error).message
        };
    }
}
