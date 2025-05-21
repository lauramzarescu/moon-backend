import PgBoss from 'pg-boss';
import logger from './logger';

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
        logger.info('PgBoss stopped successfully');
    }
}
