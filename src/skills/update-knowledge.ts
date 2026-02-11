import * as fs from 'fs';
import * as path from 'path';

export interface UpdateKnowledgeInput {
    target_section: string; // e.g., "Withdrawal Rules"
    old_content: string;    // The specific line/bullet to replace
    new_content: string;    // The new line/bullet
    rationale: string;      // Reason for change (for the log)
}

export interface UpdateKnowledgeResult {
    success: boolean;
    message: string;
    log_entry_created: boolean;
}

const KNOWLEDGE_PATH = path.join(process.cwd(), 'knowledge', 'history_prd.md');

export async function updateKnowledge(input: UpdateKnowledgeInput): Promise<UpdateKnowledgeResult> {
    const { target_section, old_content, new_content, rationale } = input;

    if (!fs.existsSync(KNOWLEDGE_PATH)) {
        return { success: false, message: "Knowledge file not found.", log_entry_created: false };
    }

    let content = fs.readFileSync(KNOWLEDGE_PATH, 'utf-8');

    // 1. Locate the Target Section (Simple grouping by Headers)
    // We look for the header, then strict matching of old_content within that "area"
    // For MVP, we'll do global replacement but verify it's near the section if possible.
    // Actually, simple string replacement is safer if old_content is unique enough.

    if (content.includes(old_content)) {
        // PERFOM UPDATE
        const updatedContent = content.replace(old_content, new_content);

        // 2. Append Traceability Log
        const logHeader = "## Change Log";
        const today = new Date().toISOString().split('T')[0];
        const logEntry = `\n| ${today} | System Agent | ${rationale} | \`${old_content.trim()}\` | \`${new_content.trim()}\` |`;

        let finalContent = updatedContent;

        if (!content.includes(logHeader)) {
            // Create Log Table if missing
            finalContent += `\n\n${logHeader}\n| Date | Actor | Rationale | Old | New |\n|---|---|---|---|---|`;
        }

        finalContent += logEntry;

        fs.writeFileSync(KNOWLEDGE_PATH, finalContent, 'utf-8');

        return {
            success: true,
            message: `Successfully updated section '${target_section}'.`,
            log_entry_created: true
        };
    } else {
        return {
            success: false,
            message: `Could not find exact content to replace: "${old_content}". Please verify the text matches exactly.`,
            log_entry_created: false
        };
    }
}
