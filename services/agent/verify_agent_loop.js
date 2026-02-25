
const { spawn } = require('child_process');

const agent = spawn('npx', ['ts-node', 'src/index.ts']);

let output = '';
let passed = false;

agent.stdout.on('data', (data) => {
    const chunk = data.toString();
    output += chunk;
    console.log(chunk);

    if (chunk.includes("User:")) {
        agent.stdin.write("Change Gold Member limit to 50000\n");
    }

    if (chunk.includes("retrieve_knowledge")) {
        console.log("SUCCESS: Agent called retrieve_knowledge!");
        passed = true;
        agent.kill();
    }
});

agent.stderr.on('data', (data) => {
    console.error(data.toString());
});

setTimeout(() => {
    if (!passed) {
        console.error("TIMEOUT: Agent did not call retrieve_knowledge in time.");
        agent.kill();
    }
}, 30000);
