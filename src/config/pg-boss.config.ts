import PgBoss from 'pg-boss';
import logger from './logger';
import {getDatabaseUrl} from './db.config';

let pgBossInstance: PgBoss | null = null;

export function getPgBossInstance(): PgBoss {
    if (!pgBossInstance) {
        const connectionString = getDatabaseUrl();
        pgBossInstance = new PgBoss(connectionString);
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