import { FunctionDeclaration, SchemaType } from "@google/generative-ai";

export const reviewTaxonomyQueueDeclaration: FunctionDeclaration = {
    name: "review_taxonomy_queue",
    description: "Fetches and manages the AI pending taxonomy suggestions queue for a given domain. Use this to review what novel categories the ingestion agent has discovered and to bulk approve or reject them.",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            action: {
                type: SchemaType.STRING,
                description: "The action to perform: 'FETCH' (to view the queue), 'APPROVE', or 'REJECT'."
            },
            suggestionIds: {
                type: SchemaType.ARRAY,
                description: "List of suggestion IDs to act upon (required for APPROVE and REJECT).",
                items: { type: SchemaType.STRING }
            },
            approvedPaths: {
                type: SchemaType.ARRAY,
                description: "List of final category paths corresponding to each approved suggestion ID. Only used if action is 'APPROVE'.",
                items: { type: SchemaType.STRING }
            }
        },
        required: ["action"]
    }
};

export async function reviewTaxonomyQueue(args: any, domainId: string) {
    if (!domainId) {
        return { error: "A domainId is required to review the taxonomy queue. Ask the user context for the active domain." };
    }

    const { action, suggestionIds, approvedPaths } = args;
    const RAG_API_URL = process.env.RAG_API_URL || "http://localhost:8001";

    try {
        if (action === "FETCH") {
            const res = await fetch(`${RAG_API_URL}/domains/${domainId}/suggestions`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            const pending = data.filter((s: any) => s.status === 'PENDING');
            if (pending.length === 0) {
                return { status: "success", message: "The taxonomy review queue is currently empty. No novel categories to review." };
            }
            return { status: "success", queue: pending };
        }

        else if (action === "APPROVE" || action === "REJECT") {
            if (!suggestionIds || suggestionIds.length === 0) {
                return { error: `suggestionIds array is required to ${action}.` };
            }

            const results = [];
            for (let i = 0; i < suggestionIds.length; i++) {
                const id = suggestionIds[i];
                let payload: any = { action: action };

                if (action === "APPROVE") {
                    payload.approvedPath = approvedPaths && approvedPaths[i] ? approvedPaths[i] : null;
                    if (!payload.approvedPath) {
                        results.push({ id, status: "error", message: "approvedPath is missing for this confirmation." });
                        continue;
                    }
                }

                const res = await fetch(`${RAG_API_URL}/domains/${domainId}/suggestions/${id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                if (res.ok) {
                    const data = await res.json();
                    results.push({ id, status: "success", backendResponse: data });
                } else {
                    const err = await res.text();
                    results.push({ id, status: "error", error: err });
                }
            }
            return { status: "success", message: `Bulk ${action} execution complete.`, results };
        }

        else {
            return { error: "Invalid action. Choose FETCH, APPROVE, or REJECT." };
        }
    } catch (e: any) {
        console.error("reviewTaxonomyQueue Error:", e);
        return { error: `Failed to interact with RAG API: ${e.message}` };
    }
}
