import { FunctionDeclaration, SchemaType } from '@google/generative-ai';
import { prisma } from '../db';

export interface KnowledgeOrchestratorInput {
    action: 'get_taxonomy' | 'propose_category' | 'write_subgraph';
    domainId: string;
    proposedPath?: string;
    reasoning?: string;
    categoryId?: string;
    sourceDocument?: string;
    projectName?: string;
    extractedBy?: string;
    status?: string;
    entities?: Array<{ name: string; type: string; description?: string }>;
    relationships?: Array<{ source: string; type: string; target: string }>;
}

export const knowledgeOrchestratorDeclaration: FunctionDeclaration = {
    name: "knowledge_orchestrator",
    description: "MASTER_KNOWLEDGE_INGESTION_TOOL: The SINGLE tool for ALL knowledge taxonomy and graph ingestion tasks. Handles retrieving the category tree, proposing new taxonomies, and persisting extracted entities/relationships to the Neo4j Graph.",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            action: {
                type: SchemaType.STRING,
                description: "The core action: 'get_taxonomy' (find existing categories), 'propose_category' (suggest new taxonomy), or 'write_subgraph' (save entities to graph)."
            },
            domainId: { type: SchemaType.STRING, description: "The domain ID." },
            proposedPath: { type: SchemaType.STRING, description: "For 'propose_category': absolute path (e.g., 'A > B > C')." },
            reasoning: { type: SchemaType.STRING, description: "For 'propose_category': justification in Chinese." },
            categoryId: { type: SchemaType.STRING, description: "For 'write_subgraph': UUID of TaxonomyNode or proposed suggestionId." },
            sourceDocument: { type: SchemaType.STRING, description: "For 'write_subgraph': source doc name." },
            projectName: { type: SchemaType.STRING, description: "Optional project name scope." },
            extractedBy: { type: SchemaType.STRING, description: "Identifier of the LLM parser." },
            status: { type: SchemaType.STRING, description: "Data status (e.g., EFFECTIVE, DRAFT)." },
            entities: {
                type: SchemaType.ARRAY,
                description: "For 'write_subgraph': Extracted entities.",
                items: {
                    type: SchemaType.OBJECT,
                    properties: {
                        name: { type: SchemaType.STRING },
                        type: { type: SchemaType.STRING },
                        description: { type: SchemaType.STRING }
                    },
                    required: ["name", "type"]
                }
            },
            relationships: {
                type: SchemaType.ARRAY,
                description: "For 'write_subgraph': Relationships between entities.",
                items: {
                    type: SchemaType.OBJECT,
                    properties: {
                        source: { type: SchemaType.STRING },
                        type: { type: SchemaType.STRING },
                        target: { type: SchemaType.STRING }
                    },
                    required: ["source", "type", "target"]
                }
            }
        },
        required: ["action", "domainId"]
    }
};

// --- Action Implementations ---

async function runGetTaxonomy(domainId: string) {
    const nodes = await prisma.taxonomyNode.findMany({ where: { domainId } });
    const nodeMap = new Map(nodes.map(n => [n.id, n]));

    const buildPath = (nodeId: string): string => {
        const node = nodeMap.get(nodeId);
        if (!node) return "";
        if (node.parentId && nodeMap.has(node.parentId)) {
            return `${buildPath(node.parentId)} > ${node.name}`;
        }
        return node.name;
    };

    const treePaths = nodes.map(n => ({
        id: n.id,
        path: buildPath(n.id),
        level: n.level
    }));

    return { taxonomy: treePaths };
}

async function runProposeCategory(domainId: string, proposedPath?: string, reasoning?: string) {
    if (!proposedPath) throw new Error("proposedPath is required for propose_category");

    const suggestionId = `sugg_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const sugg = await prisma.taxonomySuggestion.create({
        data: {
            id: suggestionId,
            domainId,
            proposedPath,
            reasoning: reasoning || "No reasoning provided",
            status: "PENDING"
        }
    });

    return {
        status: "recorded",
        suggestionId: sugg.id,
        message: `Successfully proposed category '${proposedPath}'. Use suggestionId '${sugg.id}' in your next 'write_subgraph' call.`
    };
}

async function runWriteSubgraph(input: KnowledgeOrchestratorInput) {
    if (!input.categoryId || !input.sourceDocument || !input.entities || !input.relationships) {
        throw new Error("categoryId, sourceDocument, entities, and relationships are required for write_subgraph");
    }

    const PYTHON_API = process.env.RAG_API_URL || "http://localhost:8001";

    const response = await fetch(`${PYTHON_API}/graph/ingest_subgraph`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            domainId: input.domainId,
            categoryId: input.categoryId,
            sourceDocument: input.sourceDocument,
            status: input.status,
            projectName: input.projectName,
            extractedBy: input.extractedBy,
            entities: input.entities,
            relationships: input.relationships
        })
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Python RAG API Error: ${response.status} ${errText}`);
    }

    return {
        status: "success",
        message: "Subgraph successfully written to Neo4j.",
        details: await response.json()
    };
}

// --- Main Entry Point ---

export async function knowledgeOrchestrator(input: KnowledgeOrchestratorInput) {
    try {
        switch (input.action) {
            case 'get_taxonomy':
                return await runGetTaxonomy(input.domainId);
            case 'propose_category':
                return await runProposeCategory(input.domainId, input.proposedPath, input.reasoning);
            case 'write_subgraph':
                return await runWriteSubgraph(input);
            default:
                throw new Error(`Unknown action: ${input.action}`);
        }
    } catch (error: any) {
        console.error("Knowledge Orchestrator Failed:", error);
        return { error: `Knowledge Orchestrator [${input.action}] failed: ${error.message}` };
    }
}
