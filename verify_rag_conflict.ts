
import { checkConflict } from './src/skills/conflict-checker';
import * as dotenv from 'dotenv';

dotenv.config();

async function runTest() {
    console.log("=== Testing RAG-Enhanced Conflict Checker ===");

    // Scenario: 
    // Current PRD (empty/irrelevant)
    // RAG Knowledge: "Level 5 users have a withdrawal limit of 99999." (from test_chroma.docx)
    // New Proposal: "Set Level 4 limit to 200000."

    // Logic: Level 4 should not be higher than Level 5. 
    // If the AI detects this, it proves it read the RAG context.

    const input = {
        new_requirement: "Set Level 4 withdrawal limit to 200000.",
        retrieved_context: "This is a new section about User Levels."
    };

    console.log("Input:", input);
    console.log("Waiting for AI analysis (including RAG retrieval)...");

    const result = await checkConflict(input);

    console.log("\n=== Result ===");
    console.log(JSON.stringify(result, null, 2));
}

runTest().catch(console.error);
