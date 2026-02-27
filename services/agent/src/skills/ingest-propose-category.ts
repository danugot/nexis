import { prisma } from '../db';
import { FunctionDeclaration, SchemaType } from '@google/generative-ai';

export const proposeNewCategoryDeclaration: FunctionDeclaration = {
    name: "propose_new_category",
    description: "Proposes a new taxonomy category if the parsed text contains a vital domain concept that does not fit into the existing taxonomy.",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            domainId: {
                type: SchemaType.STRING,
                description: "The domain ID this category belongs to."
            },
            proposedPath: {
                type: SchemaType.STRING,
                description: "The proposed category path MUST be an absolute path starting from a ROOT category (e.g., '票据业务 > 基础信息 > 机构参与者 > 新模块'). Do not provide partial paths."
            },
            reasoning: {
                type: SchemaType.STRING,
                description: "Why this category is needed and why existing ones don't fit. MUST BE IN CHINESE (简体中文)."
            }
        },
        required: ["domainId", "proposedPath", "reasoning"]
    }
};

export async function proposeNewCategory(args: any) {
    const { domainId, proposedPath, reasoning } = args;
    if (!domainId || !proposedPath) {
        throw new Error("domainId and proposedPath are required");
    }

    try {
        // Here we create a formal "TaxonomySuggestion" record for the PM/Admin inbox.
        // For now, we will save it in a generic string format or a dedicated DB table.
        // We will create a new generic UUID to represent it so 'write_subgraph' can link to it.
        const suggestionId = `sugg_${Date.now()}_${Math.random().toString(36).substring(7)}`;

        const sugg = await prisma.taxonomySuggestion.create({
            data: {
                id: suggestionId,
                domainId,
                proposedPath,
                reasoning,
                status: "PENDING"
            }
        });

        return {
            status: "recorded",
            suggestionId: sugg.id,
            message: `Successfully proposed category '${proposedPath}'. Use suggestionId '${sugg.id}' in your write_subgraph tool.`
        };
    } catch (e: any) {
        console.error("Failed to propose category:", e);
        throw new Error(`Failed to propose new category: ${e.message}`);
    }
}
