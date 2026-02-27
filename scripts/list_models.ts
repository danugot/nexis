import 'dotenv/config';
import { GoogleGenerativeAI } from '@google/generative-ai';

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
    console.error('Error: GEMINI_API_KEY is not set.');
    process.exit(1);
}

const genAI = new GoogleGenerativeAI(API_KEY);

console.log(`API Key loaded: ${API_KEY.substring(0, 4)}... (Length: ${API_KEY.length})`);


async function listModels() {
    try {
        // There isn't a direct listModels on the main client in some versions,
        // but we can try to infer or just try a known working model.
        // Actually, the SDK might not expose listModels easily in the high-level client.
        // Let's try to just instantiate a few and see if they work with a simple prompt.

        const candidates = [
            "gemini-1.5-flash",
            "gemini-1.5-flash-latest",
            "gemini-1.5-flash-001",
            "gemini-1.5-pro",
            "gemini-1.5-pro-latest",
            "gemini-pro",
            "gemini-2.0-flash-exp",
            "gemini-3-flash-preview"
        ];

        console.log("Testing model availability...");

        for (const modelName of candidates) {
            try {
                const model = genAI.getGenerativeModel({ model: modelName });
                const result = await model.generateContent("Hello");
                console.log(`✅ ${modelName} is AVAILABLE.`);
            } catch (e: any) {
                if (e.message.includes("404")) {
                    console.log(`❌ ${modelName} is NOT FOUND (404).`);
                } else {
                    console.log(`⚠️ ${modelName} error: ${e.message}`);
                }
            }
        }

    } catch (error) {
        console.error("Error listing models:", error);
    }
}

listModels();
