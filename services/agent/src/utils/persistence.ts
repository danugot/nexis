import * as fs from 'fs';
import * as path from 'path';

/**
 * Saves an AI-generated report to the filesystem for persistence and traceability.
 * @param type The type of report (e.g., 'PRD', 'ArchitectReport', 'TestCases')
 * @param content The markdown content of the report
 * @param projectName Optional project name for the filename
 * @returns The absolute path to the saved file
 */
export function saveReport(type: string, content: string, projectName?: string): string {
    const outputDir = path.resolve(process.cwd(), 'docs/generated');

    // Ensure the directory exists
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    const safeProjectName = (projectName || 'General').replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]/g, '_');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${safeProjectName}_${type}_${timestamp}.md`;
    const filePath = path.join(outputDir, filename);

    fs.writeFileSync(filePath, content, 'utf-8');

    return filePath;
}
