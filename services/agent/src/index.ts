import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env from project root if not found locally
const rootEnvPath = path.resolve(__dirname, '../../../.env');
dotenv.config({ path: rootEnvPath });
dotenv.config(); // Fallback to default

import { GoogleGenerativeAI, FunctionDeclaration, SchemaType } from '@google/generative-ai';
import * as fs from 'fs';
import * as readline from 'readline';
import { checkConflict } from './skills/conflict-checker';
import { withdrawSkill } from './skills/withdraw-skill';
import { retrieveKnowledge } from './skills/retrieve-knowledge'; // [NEW]
import { compareRequirementsDeclaration, compareRequirements } from './skills/compare-requirements';
import { traceDependenciesDeclaration, traceDependencies } from './skills/trace-dependencies';
import { checkComplianceDeclaration, checkCompliance } from './skills/check-compliance';
import { generateTestsDeclaration, generateTests } from './skills/generate-tests';
import { detectGapsDeclaration, detectGaps } from './skills/detect-gaps';
import { explainLineageDeclaration, explainLineage } from './skills/explain-lineage';

// --- Configuration ---
const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
    console.error('Error: GEMINI_API_KEY is not set in environment variables.');
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(API_KEY);

const KNOWLEDGE_PATH = path.join(process.cwd(), 'knowledge', 'history_prd.md');

// --- Tool Implementations (Wrappers) ---

function loadKnowledge(): string {
    if (fs.existsSync(KNOWLEDGE_PATH)) {
        return fs.readFileSync(KNOWLEDGE_PATH, 'utf-8');
    }
    return "";
}

import { updateKnowledge, UpdateKnowledgeInput } from './skills/update-knowledge';

// --- Tool Definitions (Schema) ---

const tools: FunctionDeclaration[] = [
    {
        name: "retrieve_knowledge",
        description: "Searches the Knowledge Base (Hybrid Vector + Graph) for relevant facts, rules, and history. ALWAYS call this first when handling a user request involving domain rules.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                query: {
                    type: SchemaType.STRING,
                    description: "The search query (e.g., 'Gold Member withdrawal limit')."
                }
            },
            required: ["query"]
        }
    },
    {
        name: "check_conflict",
        description: "Simulation Tool: Checks if a new requirement conflicts with the gathered context. Use this AFTER retrieving knowledge.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                new_requirement: {
                    type: SchemaType.STRING,
                    description: "The user's proposed requirement."
                },
                retrieved_context: {
                    type: SchemaType.STRING,
                    description: "The context you found via retrieve_knowledge."
                }
            },
            required: ["new_requirement", "retrieved_context"]
        }
    },
    {
        name: "withdraw_skill",
        description: "Validates if a user can withdraw a specific amount based on their level.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                user_level: {
                    type: SchemaType.NUMBER,
                    description: "The user's numeric level (e.g., 2)."
                },
                amount: {
                    type: SchemaType.NUMBER,
                    description: "The amount to withdraw."
                }
            },
            required: ["user_level", "amount"]
        }
    },
    {
        name: "update_knowledge",
        description: "Updates the knowledge file by replacing a specific line/section. Use this ONLY when the user explicitly confirms a change.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                target_section: {
                    type: SchemaType.STRING,
                    description: "The section header related to the change (e.g., 'Withdrawal Rules')."
                },
                old_content: {
                    type: SchemaType.STRING,
                    description: "The specific line to be replaced."
                },
                new_content: {
                    type: SchemaType.STRING,
                    description: "The new line to insert."
                },
                rationale: {
                    type: SchemaType.STRING,
                    description: "A brief reason for the change."
                }
            },
            required: ["target_section", "old_content", "new_content", "rationale"]
        }
    },
    {
        name: "get_knowledge",
        description: "Reads the raw content of the current PRD file (history_prd.md). Useful for line-level edits.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {},
        }
    },
    compareRequirementsDeclaration,
    traceDependenciesDeclaration,
    checkComplianceDeclaration,
    generateTestsDeclaration,
    detectGapsDeclaration,
    explainLineageDeclaration
];

// --- Main Agent Loop ---

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const ask = (query: string): Promise<string> => {
    return new Promise(resolve => rl.question(query, resolve));
};

async function main() {
    console.log("\x1b[36mWelcome to Nexis (Agent Mode: ReAct)\x1b[0m");

    const model = genAI.getGenerativeModel({
        model: "gemini-3-flash-preview", // Upgraded model
        tools: [
            {
                functionDeclarations: tools
            }
        ],
    });

    const chat = model.startChat({
        history: [
            {
                role: "user",
                parts: [{
                    text: `
                You are 'Nexis', an Advanced Business Analyst Agent.
                
                **Your Core Loop (ReAct):**
                1. **Retrieve**: When the user asks a question or proposes a change, FIRST use \`retrieve_knowledge\` to gather context (Vector + Graph).
                2. **Reason**: Analyze the retrieved info. Does the user's request conflict with existing rules? Is it ambiguous?
                3. **Act**: 
                   - If checking for consistency, call \`check_conflict\` with the context you found.
                   - If making a change, DISCUSS with the user first, then use \`update_knowledge\`.
                   - If answering a question, uses the retrieved knowledge.
                
                **Key Rule**: Do not guess. If you lack info, Retrieve it.
                ` }]
            },
            {
                role: "model",
                parts: [{ text: "Understood. I will always Retrieve, Reason, then Act. Ready to assist." }]
            }
        ]
    });


    while (true) {
        const userInput = await ask("\x1b[32mUser: \x1b[0m");
        if (userInput.toLowerCase() === 'exit' || userInput.toLowerCase() === 'quit') {
            break;
        }

        console.log("\x1b[33m[Agent] Thinking...\x1b[0m");

        try {
            let result = await chat.sendMessage(userInput);
            let response = result.response;

            // Loop to handle tool calls
            while (response.functionCalls()) {
                const functionCalls = response.functionCalls();
                if (!functionCalls) break;

                const functionResponses = [];

                for (const call of functionCalls) {
                    const name = call.name;
                    const args = call.args as any;

                    console.log(`\x1b[36m[Tool Call] ${name}(${JSON.stringify(args)})\x1b[0m`);

                    let toolResult: any;

                    if (name === "retrieve_knowledge") {
                        toolResult = await retrieveKnowledge(args);
                    } else if (name === "check_conflict") {
                        toolResult = await checkConflict(args);
                    } else if (name === "withdraw_skill") {
                        toolResult = await withdrawSkill(args);
                    } else if (name === "update_knowledge") {
                        toolResult = updateKnowledge(args);
                    } else if (name === "get_knowledge") {
                        toolResult = { content: loadKnowledge() };
                    } else if (name === "compare_requirements") {
                        toolResult = await compareRequirements(args);
                    } else if (name === "trace_dependencies") {
                        toolResult = await traceDependencies(args);
                    } else if (name === "check_compliance") {
                        toolResult = await checkCompliance(args);
                    } else if (name === "generate_tests") {
                        toolResult = await generateTests(args);
                    } else if (name === "detect_gaps") {
                        toolResult = await detectGaps(args);
                    } else if (name === "explain_lineage") {
                        toolResult = await explainLineage(args);
                    } else {
                        toolResult = { error: `Unknown tool: ${name}` };
                    }

                    // console.log(`\x1b[34m[Tool Result] ${JSON.stringify(toolResult).substring(0, 100)}...\x1b[0m`);

                    functionResponses.push({
                        functionResponse: {
                            name: name,
                            response: toolResult
                        }
                    });
                }

                // Send tool results back to the model
                result = await chat.sendMessage(functionResponses);
                response = result.response;
            }

            console.log(`\x1b[37m[Agent] ${response.text()}\x1b[0m`);

        } catch (error) {
            console.error("\x1b[31mError:\x1b[0m", error);
            // Retry logic or graceful degradation could go here
        }
    }

    rl.close();
}

main();
