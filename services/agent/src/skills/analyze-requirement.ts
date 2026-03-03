
import { FunctionDeclaration, SchemaType } from '@google/generative-ai';
import { checkCompliance } from './check-compliance';
import { traceDependencies } from './trace-dependencies';
import { detectGaps } from './detect-gaps';
import { simulateImpact } from './simulate-impact';
import { checkConflict } from './conflict-checker';
import { saveReport } from '../utils/persistence';

export const analyzeRequirementDeclaration: FunctionDeclaration = {
    name: "analyze_requirement",
    description: "MASTER_ARCHITECT_AUDIT: The PRIMARY tool for professional requirement reviews. Performs a unified, multi-dimensional analysis (Compliance, Blast Radius, Gaps, Conflicts) and generates a structured ARCHITECT_REPORT.",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            documentId: {
                type: SchemaType.STRING,
                description: "The FileId or Document ID of the PRD to analyze."
            },
            projectName: {
                type: SchemaType.STRING,
                description: "The name of the project this requirement belongs to (for context and scoping)."
            },
            focusAreas: {
                type: SchemaType.ARRAY,
                items: { type: SchemaType.STRING },
                description: "Optional specific areas to focus on (e.g., 'security', 'performance')."
            }
        },
        required: ["documentId", "projectName"]
    }
};

export interface AnalyzeRequirementInput {
    documentId: string;
    projectName: string;
    focusAreas?: string[];
}

export async function analyzeRequirement(input: AnalyzeRequirementInput, domainId?: string, emitEvent?: (event: any) => void) {
    const { documentId, projectName } = input;
    console.log(`[Master Architect] Starting comprehensive RAG analysis for project: ${projectName}, doc: ${documentId}`);

    if (emitEvent) {
        emitEvent({ type: 'audit_progress', step: 'init', message: `Initializing Architect Audit for project: ${projectName}` });
    }

    // For audit, we want to check against both established rules and other pending changes
    const status_filter = ["EFFECTIVE", "DRAFT"];

    // Provide context hints for sub-skills so they search correctly
    const searchQuery = `${projectName} requirement context from document ${documentId}`;

    // Helper to wrap skill calls with event emission
    const runWithEmit = async (name: string, label: string, task: Promise<any>) => {
        if (emitEvent) emitEvent({ type: 'audit_progress', step: 'start_subskill', name, message: `Starting: ${label}` });
        const result = await task;
        if (emitEvent) emitEvent({ type: 'audit_progress', step: 'end_subskill', name, message: `Completed: ${label}` });
        return result;
    };

    // This skill orchestrates others in parallel to build a unified report
    try {
        const [compliance, dependencies, gaps, impact] = await Promise.all([
            runWithEmit("compliance", "Compliance Verification", checkCompliance({ requirement_text: searchQuery, projectName, domainId, status_filter })),
            runWithEmit("dependencies", "Dependency Tracing (Blast Radius)", traceDependencies({ entity_name: projectName, projectName, domainId, status_filter })),
            runWithEmit("gaps", "Logical Gaps Detection", detectGaps({ target_area: searchQuery, projectName, status_filter })),
            runWithEmit("impact", "Impact Simulation", simulateImpact({ proposed_feature: searchQuery, search_keywords: projectName, projectName, status_filter }))
        ]);

        // Synthesize the "Master Report"
        // In a real scenario, we might want another LLM pass to summarize these together,
        // but for now, we return a structured object that the UI can render as Tabs.

        const masterReport = {
            verdict: "ANALYZED",
            timestamp: new Date().toISOString(),
            projectName,
            summary: "Comprehensive architectural review completed across 4 dimensions.",
            sections: {
                compliance: compliance,
                dependencies: dependencies,
                gaps: gaps,
                impact: impact
            }
        };

        const markdownContent = `# Architect Report: ${projectName}\n\n` +
            `**Date:** ${masterReport.timestamp}\n` +
            `**Status:** ${masterReport.summary}\n\n` +
            `## Compliance\n\`\`\`json\n${JSON.stringify(compliance, null, 2)}\n\`\`\`\n\n` +
            `## Dependencies\n\`\`\`json\n${JSON.stringify(dependencies, null, 2)}\n\`\`\`\n\n` +
            `## Gaps\n\`\`\`json\n${JSON.stringify(gaps, null, 2)}\n\`\`\`\n\n` +
            `## Impact Simulation\n\`\`\`json\n${JSON.stringify(impact, null, 2)}\n\`\`\``;

        const savedPath = saveReport('ArchitectReport', markdownContent, projectName);

        return {
            ...masterReport,
            report_markdown: markdownContent,
            saved_path: savedPath
        };

    } catch (error: any) {
        console.error("[Master Architect] Analysis failed:", error);
        throw new Error(`Master Architect analysis failed: ${error.message}`);
    }
}
