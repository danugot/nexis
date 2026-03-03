import { FunctionDeclaration, SchemaType } from '@google/generative-ai';

// For simplicity in this demo, since Neo4j sits in Python (rag_api/worker), 
// we will make an HTTP call from the Node Agent back to a new generic Python route 
// that purely executes Cypher based on our JSON array. 
// This fits the "Tools Outside Context" paradigm: the agent assembles the data, 
// and calls a 'dumb' write tool.

export const writeSubgraphDeclaration: FunctionDeclaration = {
    name: "write_subgraph",
    description: "Writes a set of extracted entities and relationships into the Neo4j Knowledge Graph. ALWAYS use this tool to persist data after you have decided on the correct category or proposed a new one.",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            domainId: {
                type: SchemaType.STRING,
                description: "The domain ID."
            },
            categoryId: {
                type: SchemaType.STRING,
                description: "The UUID of the TaxonomyNode OR the suggestionId from propose_new_category that these entities relate to."
            },
            sourceDocument: {
                type: SchemaType.STRING,
                description: "The name of the source document."
            },
            projectName: {
                type: SchemaType.STRING,
                description: "The project alias name, if any."
            },
            extractedBy: {
                type: SchemaType.STRING,
                description: "The identifier for the LLM that performed extraction.",
            },
            entities: {
                type: SchemaType.ARRAY,
                description: "List of entities extracted from the text.",
                items: {
                    type: SchemaType.OBJECT,
                    properties: {
                        name: { type: SchemaType.STRING, description: "Name of the entity (e.g. 'Jane Doe', 'OpenAI')" },
                        type: { type: SchemaType.STRING, description: "Type of the entity (e.g. 'PERSON', 'COMPANY', 'CONCEPT')" },
                        description: { type: SchemaType.STRING, description: "Brief description of the entity." }
                    },
                    required: ["name", "type"]
                }
            },
            relationships: {
                type: SchemaType.ARRAY,
                description: "List of relationships between the extracted entities. Ensure source and target match the entity names exactly.",
                items: {
                    type: SchemaType.OBJECT,
                    properties: {
                        source: { type: SchemaType.STRING, description: "Name of the source entity." },
                        type: { type: SchemaType.STRING, description: "Type of relationship (e.g. 'WORKS_FOR', 'FOCUSED_ON', 'USES'). MUST BE ALL CAPS WITH UNDERSCORES." },
                        target: { type: SchemaType.STRING, description: "Name of the target entity." }
                    },
                    required: ["source", "type", "target"]
                }
            }
        },
        required: ["domainId", "categoryId", "sourceDocument", "extractedBy", "entities", "relationships"]
    }
};

export async function writeSubgraph(args: any) {
    const { domainId, categoryId, sourceDocument, status, projectName, extractedBy, entities, relationships } = args;

    // We will build a 'dumb' generic endpoint in rag_api to accept this exact payload
    const PYTHON_API = process.env.RAG_API_URL || "http://localhost:8001";

    try {
        const response = await fetch(`${PYTHON_API}/graph/ingest_subgraph`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                domainId,
                categoryId,
                sourceDocument,
                status,
                projectName,
                extractedBy,
                entities: entities || [],
                relationships: relationships || []
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Python RAG API Error: ${response.status} ${errText}`);
        }

        const data = await response.json();
        return {
            status: "success",
            message: "Subgraph successfully written to Neo4j.",
            details: data
        };

    } catch (e: any) {
        console.error("Failed to write subgraph:", e);
        throw new Error(`Failed to write subgraph: ${e.message}`);
    }
}
