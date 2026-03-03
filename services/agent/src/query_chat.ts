import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
    datasources: {
        db: {
            url: "postgresql://postgres:nexis_postgres@localhost:5433/nexis_chat?schema=public"
        }
    }
});

async function main() {
    const messages = await prisma.message.findMany({
        where: {
            createdAt: {
                gte: new Date(new Date().setHours(0, 0, 0, 0))
            }
        },
        orderBy: {
            createdAt: 'asc'
        }
    });

    messages.forEach(m => {
        console.log(`[SESSION: ${m.sessionId}] [${m.role.toUpperCase()}] at ${m.createdAt}`);
        console.log(`Content: ${m.content}`);
        console.log('---');
    });
}

main()
    .catch(e => console.error(e))
    .finally(async () => {
        await prisma.$disconnect();
    });
