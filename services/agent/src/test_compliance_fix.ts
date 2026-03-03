import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Override RAG_API_URL for local testing
process.env.RAG_API_URL = "http://localhost:8000";

import { requirementAnalyzer } from './skills/requirement-analyzer';

async function testCompliance() {
    console.log("=== Testing checkCompliance with sequential logic ===");
    const complianceResult = await requirementAnalyzer({
        action: 'check_compliance',
        requirement_text: "出票登记成功之后可以直接发起提示收票吗",
        projectName: "新一代票据系统"
    }, "29f5d50f-0ad3-46d4-8d82-85dc6fa0e57e");
    console.log(JSON.stringify(complianceResult, null, 2));

    console.log("\n=== Testing checkConflict with definitional change ===");
    const conflictResult = await requirementAnalyzer({
        action: 'check_conflict',
        requirement_text: "将票据结清的超时时间改为365天"
    }, "default");
    console.log(JSON.stringify(conflictResult, null, 2));
}

testCompliance().then(() => {
    console.log("Tests finished.");
    process.exit(0);
}).catch(console.error);
