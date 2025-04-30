import PgBoss from 'pg-boss';

let pgBossInstance: PgBoss | null = null;

export function getPgBossInstance(): PgBoss {
    if (!pgBossInstance) {
        pgBossInstance = new PgBoss(process.env.DATABASE_URL as string);
    }
    return pgBossInstance;
}

export async function closePgBossInstance(): Promise<void> {
    if (pgBossInstance) {
        await pgBossInstance.stop();
        pgBossInstance = null;
        console.log('PgBoss stopped successfully');
    }
}
