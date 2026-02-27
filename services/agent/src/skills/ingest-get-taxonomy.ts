import { prisma } from '../db';
import { FunctionDeclaration, SchemaType } from '@google/generative-ai';

export const getTaxonomyDeclaration: FunctionDeclaration = {
    name: "get_taxonomy",
    description: "Fetches the current verified taxonomy/ontology tree for a given domain to understand what categories exist.",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            domainId: {
                type: SchemaType.STRING,
                description: "The domain ID to fetch the taxonomy for."
            }
        },
        required: ["domainId"]
    }
};

export async function getTaxonomy(args: any) {
    const { domainId } = args;
    if (!domainId) {
        throw new Error("domainId is required");
    }

    try {
        const nodes = await prisma.taxonomyNode.findMany({
            where: { domainId }
        });

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
    } catch (e: any) {
        throw new Error(`Failed to fetch taxonomy: ${e.message}`);
    }
}
