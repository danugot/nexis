
import fetch from "node-fetch";

export interface RetrieveKnowledgeInput {
    query: string;
    n_results?: number;
    projectName?: string;
    documentIds?: string[];
    status_filter?: string[]; // e.g. ["EFFECTIVE", "DRAFT"]
}

export interface KnowledgeItem {
    type: "vector" | "graph";
    content: string;
    source: string;
    status?: string;
}

export interface RetrieveKnowledgeResult {
    context: KnowledgeItem[];
    formatted_output: string; // Helper for LLM consumption
}

export async function retrieveKnowledge(input: RetrieveKnowledgeInput, domainId?: string): Promise<RetrieveKnowledgeResult> {
    const { query, n_results = 5, projectName, status_filter } = input;

    const RAG_API_URL = process.env.RAG_API_URL || "http://rag_api:8000";

    try {
        const response = await fetch(`${RAG_API_URL}/retrieve`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                query,
                n_results,
                domain_id: domainId,
                project_name: projectName,
                document_ids: input.documentIds,
                status_filter
            })
        });

        if (!response.ok) {
            throw new Error(`RAG Service Error: ${response.statusText}`);
        }

        const data: any = await response.json();
        const context_items = data.context as KnowledgeItem[];

        // DIAGNOSTIC: Log raw retrieval count and sources
        console.log(`[DIAGNOSTIC] RAG API returned ${context_items.length} items.`);
        context_items.forEach((item, idx) => {
            console.log(`[DIAGNOSTIC] Item ${idx + 1}: Type=${item.type}, Source=${item.source}`);
        });

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
