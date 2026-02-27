import fetch from 'node-fetch';

async function testIngestion() {
    console.log("Starting test for /ingest-chunk on Node.js Agent...");

    const testPayload = {
        domainId: "test-domain-123",
        source: "finance_report_test.pdf",
        text: `According to the latest Q3 report from AlphaTech Inc, their new "Quantum Compute Blade" division has seen a 40% growth. CEO Jane Doe announced that they will be filing for a new patent in November.`
    };

    try {
        const response = await fetch('http://localhost:8002/ingest-chunk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(testPayload)
        });

        if (!response.ok) {
            console.error("HTTP Error:", response.status, await response.text());
            return;
        }

        const data = await response.json();
        console.log("Success!");
        console.log("Cycles taken:", data.cycles);
        console.log("Agent Final Text:", data.finalAgentText);

    } catch (e: any) {
        console.error("Test failed:", e.message);
    }
}

testIngestion();
