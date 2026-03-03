
import { FunctionDeclaration, SchemaType } from '@google/generative-ai';
import fetch from 'node-fetch';

export const getDocumentContentDeclaration: FunctionDeclaration = {
    name: "get_document_content",
    description: "Retrieves the full text content of an uploaded document by its unique FileId. Use this when the user mentions a [FileId: xxx] to extract the text for further analysis or auditing.",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            fileId: {
                type: SchemaType.STRING,
                description: "The unique document ID (e.g. from [FileId: xxx])."
            }
        },
        required: ["fileId"]
    }
};

export async function getDocumentContent(fileId: string) {
    const RAG_API_URL = process.env.RAG_API_URL || 'http://localhost:8000';
    console.log(`[Skill] Fetching content for fileId: ${fileId} from ${RAG_API_URL}`);

    try {
        const response = await fetch(`${RAG_API_URL}/documents/${fileId}/content`);
        if (!response.ok) {
            throw new Error(`RAG API responded with status: ${response.status}`);
        }
        return await response.json();
    } catch (error: any) {
        console.error(`[Skill] Failed to fetch document ${fileId}:`, error.message);
        return { error: `Could not retrieve document content: ${error.message}` };
    }
}
