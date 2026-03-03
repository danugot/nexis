import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Override RAG_API_URL for local testing
process.env.RAG_API_URL = "http://localhost:8000";

import { checkCompliance } from './skills/check-compliance';
import { checkConflict } from './skills/conflict-checker';

async function testCompliance() {
    console.log("=== Testing checkCompliance with sequential logic ===");
    const complianceResult = await checkCompliance({
        requirement_text: "出票登记成功之后可以直接发起提示收票吗",
        domainId: "29f5d50f-0ad3-46d4-8d82-85dc6fa0e57e", // current domain id based on rag_api logs
        projectName: "新一代票据系统"
    });
    console.log(JSON.stringify(complianceResult, null, 2));

    console.log("\n=== Testing checkConflict with definitional change ===");
    const conflictResult = await checkConflict({
        new_requirement: "将票据结清的超时时间改为365天",
        retrieved_context: "" // In a real scenario, this would be populated by the index loop
    });
    console.log(JSON.stringify(conflictResult, null, 2));
}

testCompliance().then(() => {
    console.log("Tests finished.");
    process.exit(0);
}).catch(console.error);
