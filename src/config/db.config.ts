import {PrismaClient} from '@prisma/client';
import logger from './logger';

// Database configuration from environment variables
interface DbConfig {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    max: number;
    idleTimeoutMillis: number;
    connectionTimeoutMillis: number;
}

// Load database configuration from environment variables
const dbConfig: DbConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'samluser',
    password: process.env.DB_PASSWORD || 'samlpass',
    database: process.env.DB_NAME || 'samldb',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
};

// Create a Prisma client instance using the constructed URL
const prisma = new PrismaClient({
    datasources: {
        db: {
            url: process.env.DATABASE_URL,
        },
    },
});

// Initialize Prisma client with retry logic
async function initPrisma(maxRetries = 5, retryInterval = 5000): Promise<PrismaClient> {
    let retries = maxRetries;

    while (retries > 0) {
        try {
            // Test the connection
            await prisma.$connect();
            logger.info('Successfully connected to database via Prisma');
            return prisma;
        } catch (err) {
            retries -= 1;
            logger.error(`Failed to connect to database via Prisma. Retries left: ${retries}`);

            if (err instanceof Error) {
                logger.error(`Error details: ${err.message}`);
            }

            if (retries === 0) {
                logger.error('Max retries reached. Could not connect to database via Prisma');
                throw new Error('Failed to connect to database via Prisma after multiple attempts');
            }

            // Wait before retrying
            await new Promise(resolve => setTimeout(resolve, retryInterval));
        }
    }

    // This should never be reached due to the throw above, but TypeScript needs it
    throw new Error('Failed to connect to database via Prisma');
}

// Gracefully disconnect from the database
async function disconnectPrisma(): Promise<void> {
    await prisma.$disconnect();
    logger.info('Disconnected from database');
}

export {prisma, dbConfig, initPrisma, disconnectPrisma};
