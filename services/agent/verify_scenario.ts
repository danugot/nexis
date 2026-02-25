import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

async function runVerification() {
    console.log("--- Starting Verification of Node.js Agent ---");

    // 1. Reset Knowledge Base
    const initialContent = `# History PRD - Permissions Matrix

## 1. User Roles
* **Ordinary Member**: Level 1-3
* **Gold Member**: Level 4+

## 2. Withdrawal Rules
* **普通会员（Level 1-3）无提现权限**
* **黄金会员（Level 4+）提现上限 5000**
`;
    fs.writeFileSync(path.join(process.cwd(), 'knowledge', 'history_prd.md'), initialContent);
    console.log("✅ Knowledge base reset.");

    // 2. Start the Agent Process
    // Using ts-node to run directly
    const agent = spawn('npx', ['ts-node', 'src/index.ts'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: process.cwd()
    });

    const userInput = "我想让 Level 2 的用户可以提现 2500 元试用，你觉得行吗？\n";
    let outputBuffer = "";

    agent.stdout.on('data', (data) => {
        const chunk = data.toString();
        outputBuffer += chunk;
        process.stdout.write(chunk); // Mirror output

        // 3. Interact
        if (chunk.includes("User:")) {
            // Wait a bit to ensure prompt is ready
            if (!outputBuffer.includes(userInput.trim())) {
                // console.log(`Sending: ${userInput.trim()}`);
                agent.stdin.write(userInput);
            }
        }

        if (chunk.includes("Do you want to apply this change?")) {
            // console.log("Sending confirmation...");
            agent.stdin.write("y\n");
        }

        if (chunk.includes("SUCCESS")) {
            // checking file content
            agent.kill();
        }
    });

    agent.stderr.on('data', (data) => {
        console.error(`Stderr: ${data}`);
    });

    // Wait for process to exit or timeout
    await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
            console.log("Timeout waiting for agent.");
            agent.kill();
            resolve();
        }, 15000);

        agent.on('exit', () => {
            clearTimeout(timeout);
            resolve();
        });
    });

    // 4. Verify File Content
    const content = fs.readFileSync(path.join(process.cwd(), 'knowledge', 'history_prd.md'), 'utf-8');
    if (content.includes("Level 2 可提现")) {
        console.log("\n🎉 ALL CHECKS PASSED: File updated successfully.");
    } else {
        console.log("\n❌ VERIFICATION FAILED: File content not updated.");
        // console.log("Content:", content);
    }
}

runVerification();
