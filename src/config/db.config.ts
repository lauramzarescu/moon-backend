import {PrismaClient} from '@prisma/client';
import {Pool} from 'pg';

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

// Construct the database URL directly
const DATABASE_URL = `postgresql://${dbConfig.user}:${dbConfig.password}@${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`;

// Create a PostgreSQL pool for direct database access if needed
const pool = new Pool(dbConfig);

// Create a Prisma client instance using the constructed URL
const prisma = new PrismaClient({
    datasources: {
        db: {
            url: DATABASE_URL,
        },
    },
});

// Connection with retry logic for the PostgreSQL pool
async function connectWithRetry(maxRetries = 5, retryInterval = 5000): Promise<Pool> {
    let retries = maxRetries;

    while (retries > 0) {
        try {
            const client = await pool.connect();
            console.log('Successfully connected to PostgreSQL database');
            client.release();
            return pool;
        } catch (err) {
            retries -= 1;
            console.error(`Failed to connect to PostgreSQL. Retries left: ${retries}`);

            if (err instanceof Error) {
                console.error(`Error details: ${err.message}`);
            }

            if (retries === 0) {
                console.error('Max retries reached. Could not connect to PostgreSQL');
                throw new Error('Failed to connect to database after multiple attempts');
            }

            // Wait before retrying
            await new Promise(resolve => setTimeout(resolve, retryInterval));
        }
    }

    // This should never be reached due to the throw above, but TypeScript needs it
    throw new Error('Failed to connect to database');
}

// Initialize Prisma client with retry logic
async function initPrisma(maxRetries = 5, retryInterval = 5000): Promise<PrismaClient> {
    let retries = maxRetries;

    while (retries > 0) {
        try {
            // Test the connection
            await prisma.$connect();
            console.log('Successfully connected to database via Prisma');
            return prisma;
        } catch (err) {
            retries -= 1;
            console.error(`Failed to connect to database via Prisma. Retries left: ${retries}`);

            if (err instanceof Error) {
                console.error(`Error details: ${err.message}`);
            }

            if (retries === 0) {
                console.error('Max retries reached. Could not connect to database via Prisma');
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
async function disconnect(): Promise<void> {
    await prisma.$disconnect();
    await pool.end();
    console.log('Disconnected from database');
}

export {
    prisma,
    pool,
    dbConfig,
    DATABASE_URL,
    connectWithRetry,
    initPrisma,
    disconnect
};
