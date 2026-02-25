
import fetch from "node-fetch";

export interface RetrieveKnowledgeInput {
    query: string;
    n_results?: number;
}

export interface KnowledgeItem {
    type: "vector" | "graph";
    content: string;
    source: string;
}

export interface RetrieveKnowledgeResult {
    context: KnowledgeItem[];
    formatted_output: string; // Helper for LLM consumption
}

export async function retrieveKnowledge(input: RetrieveKnowledgeInput, domainId?: string): Promise<RetrieveKnowledgeResult> {
    const { query, n_results = 3 } = input;

    try {
        const response = await fetch("http://localhost:8001/retrieve", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query, n_results, domain_id: domainId })
        });

        if (!response.ok) {
            throw new Error(`RAG Service Error: ${response.statusText}`);
        }

        const data: any = await response.json();
        const context_items = data.context as KnowledgeItem[];

        // Format for LLM
        const formatted = context_items.map(item =>
            `[${item.type.toUpperCase()}] (${item.source}): ${item.content}`
        ).join("\n");

        return {
            context: context_items,
            formatted_output: formatted
        };

    } catch (error) {
        console.error("Knowledge Retrieval Verification Failed:", error);
        return {
            context: [],
            formatted_output: "Error: Could not retrieve knowledge."
        };
    }
}
