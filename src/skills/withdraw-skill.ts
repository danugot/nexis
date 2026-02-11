import * as fs from 'fs';
import * as path from 'path';

export interface WithdrawInput {
    user_level: number;
    amount: number;
}

export interface WithdrawResult {
    allowed: boolean;
    reason: string;
    limit?: number;
}

const KNOWLEDGE_PATH = path.join(process.cwd(), 'knowledge', 'history_prd.md');

function loadLimits(): Record<number, number> {
    const limits: Record<number, number> = {};

    // Default fallback
    limits[4] = 5000;

    if (fs.existsSync(KNOWLEDGE_PATH)) {
        const content = fs.readFileSync(KNOWLEDGE_PATH, 'utf-8');

        // Parse "Level X (Amount)" pattern
        // Matches: Level 1 (1000), Level 2 (2500)
        const specificLevelRegex = /Level\s*(\d+)\s*[（(](\d+)[)）]/g;
        let match;
        while ((match = specificLevelRegex.exec(content)) !== null) {
            const level = parseInt(match[1]);
            const amount = parseInt(match[2]);
            limits[level] = amount;
        }

        // Parse "Gold/Level 4+" pattern
        // Matches: 黄金会员（Level 4+）... 8000
        const goldRegex = /黄金会员.*?Level\s*4\+.*?(\d+)/;
        const goldMatch = content.match(goldRegex);
        if (goldMatch) {
            limits[4] = parseInt(goldMatch[1]); // Treat 4 as "4+" base
        }
    }
    return limits;
}

export async function withdrawSkill(input: WithdrawInput): Promise<WithdrawResult> {
    const { user_level, amount } = input;
    const limits = loadLimits();

    // Logic: 
    // 1. Check if specific level exists in limits
    // 2. If not, check if level >= 4 (Gold)

    let allowedLimit = 0;

    if (limits[user_level]) {
        allowedLimit = limits[user_level];
    } else if (user_level >= 4 && limits[4]) {
        allowedLimit = limits[4];
    } else {
        // No permission defined for this level (e.g. Level 0 or unlisted)
        return {
            allowed: false,
            reason: `Level ${user_level} users have no withdrawal permissions defined in PRD.`,
            limit: 0
        };
    }

    if (amount <= allowedLimit) {
        return {
            allowed: true,
            reason: `Withdrawal of ${amount} is within the limit of ${allowedLimit} for Level ${user_level}.`,
            limit: allowedLimit
        };
    } else {
        return {
            allowed: false,
            reason: `Amount ${amount} exceeds the limit of ${allowedLimit} for Level ${user_level}.`,
            limit: allowedLimit
        };
    }
}
