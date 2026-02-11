import * as fs from 'fs';
import * as path from 'path';
import Redis from 'ioredis';

const RAW_DOCS_DIR = path.join(process.cwd(), 'raw_docs');
const QUEUE_NAME = 'nexis:ingest:queue';

// Connect to Redis
const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
});

console.log(`[Nexis Refinery] Producer connected to Redis at ${process.env.REDIS_HOST || 'localhost'}`);
console.log(`[Nexis Refinery] Watching for new documents in: ${RAW_DOCS_DIR}`);

// Ensure raw docs dir exists
if (!fs.existsSync(RAW_DOCS_DIR)) {
    fs.mkdirSync(RAW_DOCS_DIR, { recursive: true });
}

fs.watch(RAW_DOCS_DIR, (eventType, filename) => {
    if (eventType === 'rename' && filename && !filename.startsWith('.')) {
        const filePath = path.join(RAW_DOCS_DIR, filename);

        if (fs.existsSync(filePath)) {
            try {
                const stats = fs.statSync(filePath);
                if (!stats.isFile()) return;
            } catch (err) {
                return;
            }

            console.log(`[Nexis Refinery] Detected new file: ${filename}`);
            enqueueJob(filePath, filename);
        }
    }
});

async function enqueueJob(filePath: string, filename: string) {
    const ext = path.extname(filename).toLowerCase();
    if (!['.docx', '.pdf', '.pptx', '.xlsx'].includes(ext)) {
        console.log(`[Nexis Refinery] Skipping unsupported file type: ${filename}`);
        return;
    }

    const job = {
        filePath: filePath,
        filename: filename,
        timestamp: Date.now()
    };

    try {
        await redis.rpush(QUEUE_NAME, JSON.stringify(job));
        console.log(`[Nexis Refinery] Job Enqueued: ${filename}`);
    } catch (err) {
        console.error(`[Nexis Refinery] Failed to enqueue job: ${err}`);
    }
}
