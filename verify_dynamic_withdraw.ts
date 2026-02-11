
import { withdrawSkill } from './src/skills/withdraw-skill';

async function verify() {
    console.log("--- Verifying Dynamic Withdrawal Rules ---");

    const tests = [
        { level: 3, amount: 3500, expected: true, desc: "Level 3 withdraw 3500 (Limit 4000)" },
        { level: 3, amount: 4100, expected: false, desc: "Level 3 withdraw 4100 (Limit 4000)" },
        { level: 2, amount: 2500, expected: true, desc: "Level 2 withdraw 2500 (Limit 2500)" },
        { level: 1, amount: 1000, expected: true, desc: "Level 1 withdraw 1000 (Limit 1000)" },
        { level: 1, amount: 1200, expected: false, desc: "Level 1 withdraw 1200 (Limit 1000)" },
        { level: 4, amount: 6000, expected: true, desc: "Level 4 withdraw 6000 (Limit 8000)" }, // Gold updated to 8000
    ];

    let passed = 0;

    for (const t of tests) {
        const result = await withdrawSkill({ user_level: t.level, amount: t.amount });
        const success = result.allowed === t.expected;
        const icon = success ? "✅" : "❌";
        console.log(`${icon} [${t.desc}] Result: ${result.allowed} (Reason: ${result.reason})`);
        if (success) passed++;
    }

    console.log(`\nPassed ${passed}/${tests.length} tests.`);
    if (passed === tests.length) {
        console.log("SUCCESS: Code logic is fully synced with PRD!");
    } else {
        console.log("FAILURE: Some tests failed.");
        process.exit(1);
    }
}

verify();
