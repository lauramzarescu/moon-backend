import {Server, Socket} from 'socket.io';
import {createServer} from 'http';
import express, {Express} from 'express';
import {SocketDetailsService} from '../services/socket.service';
import {AuthService} from '../services/auth.service';
import * as cookie from 'cookie';
import {SOCKET_EVENTS} from '../constants/socket-events';
import {UserRepository} from '../repositories/user/user.repository';
import {prisma} from './db.config';
import {JwtInterface} from '../interfaces/jwt/jwt.interface';
import {ClientInfoResponse} from '../interfaces/socket/socket-response.interface';
import logger from './logger';

export const app: Express = express();
app.set('trust proxy', true);

export const httpServer = createServer(app);
export const io = new Server(httpServer, {
    cors: {
        origin: [process.env.APP_URL || 'http://localhost:5173', process.env.API_URL || 'http://localhost:3000'],
        methods: ['GET', 'POST'],
        credentials: true,
    },
    transports: ['polling', 'websocket'],
    allowUpgrades: true,
});

const socketDetailsService = SocketDetailsService.getInstance();
const connectedClients = new Map();
const userRepository = new UserRepository(prisma);

// Interval management constants
const ALLOWED_MANUAL_INTERVALS = [5, 10, 15, 60]; // seconds - allowed manual intervals
const DEFAULT_MANUAL_INTERVAL = 10; // seconds - default manual interval
const AUTOMATIC_MIN_INTERVAL = 3; // seconds - minimum automatic interval
const AUTOMATIC_MAX_INTERVAL = 120; // seconds - maximum automatic interval
const AUTOMATIC_DEFAULT_INTERVAL = 3; // seconds - starting automatic interval
const INTERVAL_INCREASE_FACTOR = 2;
const INTERVAL_DECREASE_FACTOR = 0.5;
const HEALTH_CHECK_WINDOW = 5;

// Global interval state
let currentAutomaticInterval = AUTOMATIC_DEFAULT_INTERVAL; // Dynamic interval for automatic mode
let successfulRequestsCount = 0;

export interface AuthenticatedSocket extends Socket {
    userId: string;
    userInfo?: JwtInterface & {email: string; organizationId: string};
    ipAddress?: string;
}

interface ClientInfo {
    sockets: AuthenticatedSocket[];
    timeoutId: NodeJS.Timeout | null;
    intervalTime: number; // in milliseconds
    isAutomatic: boolean;
    isExecuting?: boolean;
    useProgressiveLoading?: boolean;
}

const createClientInfoResponse = (userId: string): ClientInfoResponse => {
    const client = connectedClients.get(userId);

    if (!client) {
        return {
            isAutomatic: false,
            isExecuting: false,
            useProgressiveLoading: false,
            connectedSockets: 0,
            intervalTime: 0, // Manual mode by default
            automaticIntervalTime: currentAutomaticInterval,
        };
    }

    return {
        isAutomatic: client.isAutomatic,
        isExecuting: client.isExecuting || false,
        useProgressiveLoading: client.useProgressiveLoading || false,
        connectedSockets: client.sockets.length,
        intervalTime: client.intervalTime / 1000,
        automaticIntervalTime: currentAutomaticInterval,
    };
};

// Export the helper function for use in services
export const getClientInfoResponse = createClientInfoResponse;

// Validate manual interval
const validateManualInterval = (intervalTime: number): boolean => {
    return ALLOWED_MANUAL_INTERVALS.includes(intervalTime);
};

// Update all automatic clients to the new interval
const updateAllAutomaticClients = (newAutomaticInterval: number) => {
    logger.info(`[INTERVAL] Updating all automatic clients to new interval: ${newAutomaticInterval} seconds`);

    const automaticClients = Array.from(connectedClients.entries()).filter(([_, client]) => client.isAutomatic);
    logger.info(`[INTERVAL] Current automatic clients: ${automaticClients.length}`);

    automaticClients.forEach(([userId, client]) => {
        if (client.timeoutId) {
            clearTimeout(client.timeoutId);
        }

        // Update the interval time for automatic clients
        client.intervalTime = newAutomaticInterval * 1000;

        scheduleNextExecution(client, userId);

        // Notify all sockets for this user about the interval update
        for (const userSocket of client.sockets) {
            if (userSocket.connected) {
                userSocket.emit(SOCKET_EVENTS.INTERVAL_UPDATED, {
                    clientInfo: createClientInfoResponse(userId),
                });
            }
        }
    });
};

const increaseAutomaticInterval = () => {
    logger.info(`[THROTTLE] Rate limit detected. Current automatic interval: ${currentAutomaticInterval}s`);
    successfulRequestsCount = 0;
    const newInterval = Math.min(currentAutomaticInterval * INTERVAL_INCREASE_FACTOR, AUTOMATIC_MAX_INTERVAL);

    if (newInterval !== currentAutomaticInterval) {
        logger.info(`[THROTTLE] Increasing automatic interval from ${currentAutomaticInterval}s to ${newInterval}s`);
        currentAutomaticInterval = newInterval;
        updateAllAutomaticClients(currentAutomaticInterval);
    } else {
        logger.info(`[THROTTLE] Already at maximum automatic interval: ${AUTOMATIC_MAX_INTERVAL}s`);
    }
};

const decreaseAutomaticInterval = () => {
    logger.info(`[HEALTH] Health check passed. Current automatic interval: ${currentAutomaticInterval}s`);
    successfulRequestsCount = 0;
    const newInterval = Math.max(currentAutomaticInterval * INTERVAL_DECREASE_FACTOR, AUTOMATIC_MIN_INTERVAL);

    if (newInterval !== currentAutomaticInterval) {
        logger.info(`[HEALTH] Decreasing automatic interval from ${currentAutomaticInterval}s to ${newInterval}s`);
        currentAutomaticInterval = newInterval;
        updateAllAutomaticClients(currentAutomaticInterval);
    } else {
        logger.info(`[HEALTH] Already at minimum automatic interval: ${AUTOMATIC_MIN_INTERVAL}s`);
    }
};

const executeWithHealthCheck = async (socket: AuthenticatedSocket, client: ClientInfo) => {
    try {
        if (client.useProgressiveLoading) {
            await socketDetailsService.generateClusterDetailsProgressive(socket);
        } else {
            await socketDetailsService.generateClusterDetails(socket);
        }

        // Only track health for automatic clients
        if (client.isAutomatic) {
            successfulRequestsCount++;
            if (successfulRequestsCount >= HEALTH_CHECK_WINDOW) {
                decreaseAutomaticInterval();
            }
        }
    } catch (error: any) {
        logger.error(`[ERROR] Execute failed: ${error.message}`);

        // Only adjust automatic interval on errors for automatic clients
        if (client.isAutomatic) {
            successfulRequestsCount = 0;
            increaseAutomaticInterval();
        }

        socket.emit('clusters-error', {
            error: 'Failed to fetch cluster information',
            details: error,
            clientInfo: createClientInfoResponse(socket.userId),
        });
    }
};

const scheduleNextExecution = (client: ClientInfo, userId: string) => {
    if (client.intervalTime <= 0) {
        logger.info(
            `[SCHEDULE] Not scheduling next execution for user ${userId} - manual mode (intervalTime: ${client.intervalTime})`
        );
        return;
    }

    // Clear any existing timeout before setting a new one
    if (client.timeoutId) {
        clearTimeout(client.timeoutId);
        client.timeoutId = null;
    }

    logger.info(`[SCHEDULE] Scheduling next execution for user ${userId} in ${client.intervalTime}ms`);

    client.timeoutId = setTimeout(async () => {
        if (client.intervalTime <= 0) {
            logger.info(`[EXECUTION] Skipping execution for user ${userId} - now in manual mode`);
            return;
        }

        client.isExecuting = true;

        // Notify all sockets that execution started
        for (const userSocket of client.sockets) {
            if (userSocket.connected) {
                userSocket.emit('client-info-updated', createClientInfoResponse(userId));
            }
        }

        try {
            logger.info(`[EXECUTION] Executing for user ${userId}`);

            for (const userSocket of client.sockets) {
                if (userSocket.connected) {
                    await executeWithHealthCheck(userSocket, client);
                }
            }
        } catch (error: any) {
            logger.error(`[ERROR] Error during execution for user ${userId}:`, error);
        } finally {
            client.isExecuting = false;

            // Notify all sockets that execution finished
            for (const userSocket of client.sockets) {
                if (userSocket.connected) {
                    userSocket.emit('client-info-updated', createClientInfoResponse(userId));
                }
            }

            // Schedule next execution if client still exists and has valid interval
            if (connectedClients.has(userId) && client.intervalTime > 0) {
                scheduleNextExecution(client, userId);
            } else {
                logger.info(
                    `[EXECUTION] Not scheduling next execution for user ${userId} - manual mode or client disconnected`
                );
            }
        }
    }, client.intervalTime);
};

io.use(async (socket: Socket, next) => {
    try {
        logger.info(`[AUTH] New connection attempt from ${socket.id}`);
        const cookieHeader = socket.handshake.headers.cookie;

        if (!cookieHeader) {
            return next(new Error('Authentication required'));
        }

        const cookies = cookie.parse(cookieHeader);
        const token = cookies['token'];

        if (!token) {
            return next(new Error('Authentication token not found'));
        }

        const decoded = AuthService.decodeToken(token);
        const authSocket = socket as AuthenticatedSocket;
        const user = await userRepository.getOne(decoded.userId);

        authSocket.userId = decoded.userId;
        authSocket.userInfo = {
            ...decoded,
            email: user.email,
            organizationId: user.organizationId || 'unknown',
        };
        authSocket.ipAddress =
            (typeof socket.handshake.headers['x-forwarded-for'] === 'string'
                ? (socket.handshake.headers['x-forwarded-for'] as string).split(',')[0]?.trim()
                : Array.isArray(socket.handshake.headers['x-forwarded-for'])
                  ? socket.handshake.headers['x-forwarded-for'][0]?.split(',')[0]?.trim()
                  : undefined) ||
            (socket.handshake.headers['x-real-ip'] as string) ||
            (socket.handshake.headers['cf-connecting-ip'] as string) ||
            socket.handshake.address;

        next();
    } catch (error: any) {
        logger.error(`[AUTH] Authentication failed for ${socket.id}:`, error);
        next(new Error('Invalid authentication token'));
    }
});

io.on('connection', async (_socket: Socket) => {
    logger.info(`[CONNECTION] New connection from ${_socket.id}`);
    const socket = _socket as AuthenticatedSocket;
    const userId = socket.userId;

    if (!connectedClients.has(userId)) {
        logger.info(`[CONNECTION] First connection for user ${userId}`);
        const clientInfo: ClientInfo = {
            sockets: [socket],
            timeoutId: null,
            intervalTime: 0, // Start in manual mode (0 = manual)
            isAutomatic: false,
            useProgressiveLoading: false,
        };
        connectedClients.set(userId, clientInfo);
    } else {
        logger.info(`[CONNECTION] Additional connection for user ${userId}`);
        const client = connectedClients.get(userId);
        client.sockets.push(socket);
    }

    // Send initial client info
    socket.emit('client-info-updated', createClientInfoResponse(userId));

    socket.on(SOCKET_EVENTS.TOGGLE_PROGRESSIVE_LOADING, (enabled: boolean) => {
        const client = connectedClients.get(userId);
        if (client) {
            client.useProgressiveLoading = enabled;
            logger.info(`[PROGRESSIVE] User ${userId} ${enabled ? 'enabled' : 'disabled'} progressive loading`);

            // Send updated client info to all sockets
            for (const userSocket of client.sockets) {
                if (userSocket.connected) {
                    userSocket.emit('client-info-updated', createClientInfoResponse(userId));
                }
            }
        }
    });

    // Refresh specific cluster services
    socket.on(SOCKET_EVENTS.REFRESH_CLUSTER_SERVICES, async (data: {clusterName: string}) => {
        logger.info(`[REFRESH] User ${userId} requested refresh for cluster services: ${data.clusterName}`);
        await socketDetailsService.refreshClusterServices(socket, data.clusterName);
    });

    // Refresh specific cluster scheduled tasks
    socket.on(
        SOCKET_EVENTS.REFRESH_CLUSTER_SCHEDULED_TASKS,
        async (data: {clusterName: string; clusterArn: string}) => {
            logger.info(`[REFRESH] User ${userId} requested refresh for cluster scheduled tasks: ${data.clusterName}`);
            await socketDetailsService.refreshClusterScheduledTasks(socket, data.clusterName, data.clusterArn);
        }
    );

    // Get EC2 inventory only
    socket.on(SOCKET_EVENTS.GET_EC2_INVENTORY, async () => {
        logger.info(`[EC2] User ${userId} requested EC2 inventory`);
        await socketDetailsService.getEC2InventoryOnly(socket);
    });

    socket.on(SOCKET_EVENTS.INTERVAL_SET, (mode: number) => {
        const client = connectedClients.get(userId);
        logger.info(`[INTERVAL] User ${userId} requested interval change to ${mode}s`);

        if (!client) {
            logger.error(`[INTERVAL] Client not found for user ${userId}`);
            return;
        }

        // Clear existing timeout
        if (client.timeoutId) {
            logger.info(`[INTERVAL] Clearing existing timeout for user ${userId}`);
            clearTimeout(client.timeoutId);
            client.timeoutId = null;
        }

        if (mode === 0) {
            // Manual mode - no automatic refresh
            logger.info(`[INTERVAL] Setting manual mode for user ${userId}`);
            client.isAutomatic = false;
            client.intervalTime = 0;
        } else if (mode === -1) {
            // Automatic mode - use dynamic interval
            logger.info(
                `[INTERVAL] Setting automatic mode for user ${userId} starting at ${currentAutomaticInterval}s`
            );
            client.isAutomatic = true;
            client.intervalTime = currentAutomaticInterval * 1000;
        } else {
            // Manual interval mode - validate the interval
            if (!validateManualInterval(mode)) {
                logger.error(
                    `[INTERVAL] Invalid manual interval ${mode}s for user ${userId}. Allowed: ${ALLOWED_MANUAL_INTERVALS.join(', ')}`
                );
                socket.emit('interval-error', {
                    error: `Invalid interval. Allowed values: ${ALLOWED_MANUAL_INTERVALS.join(', ')} seconds`,
                    allowedIntervals: ALLOWED_MANUAL_INTERVALS,
                });
                return;
            }

            logger.info(`[INTERVAL] Setting manual interval mode for user ${userId} at ${mode}s`);
            client.isAutomatic = false;
            client.intervalTime = mode * 1000;
        }

        // Send updated client info
        const clientInfoResponse = createClientInfoResponse(userId);
        for (const userSocket of client.sockets) {
            if (userSocket.connected) {
                userSocket.emit(SOCKET_EVENTS.INTERVAL_UPDATED, {
                    clientInfo: clientInfoResponse,
                });
            }
        }

        // Start scheduling if not in manual mode
        if (client.intervalTime > 0) {
            scheduleNextExecution(client, userId);
        }
    });

    socket.on(SOCKET_EVENTS.MANUAL_REFRESH, async () => {
        logger.info(`[MANUAL] Manual refresh requested by user ${userId}`);
        const client = connectedClients.get(userId);
        if (client) {
            await executeWithHealthCheck(socket, client);
        }
    });

    socket.on(SOCKET_EVENTS.CLUSTERS_UPDATE, async () => {
        logger.info(`[UPDATE] Cluster update requested by user ${userId}`);
        const client = connectedClients.get(userId);
        if (client) {
            await executeWithHealthCheck(socket, client);
        }
    });

    socket.on(SOCKET_EVENTS.DISCONNECT, () => {
        logger.info(`[DISCONNECT] Socket ${socket.id} disconnected for user ${userId}`);
        const client = connectedClients.get(userId);
        if (client) {
            client.sockets = client.sockets.filter((s: Socket) => s.id !== socket.id);

            if (client.sockets.length === 0) {
                logger.info(`[DISCONNECT] Cleaning up last connection for user ${userId}`);
                if (client.timeoutId) {
                    clearTimeout(client.timeoutId);
                }
                connectedClients.delete(userId);
            } else {
                logger.info(`[DISCONNECT] User ${userId} still has ${client.sockets.length} active connections`);
            }
        }
    });

    // Initial load with progressive loading by default
    const client = connectedClients.get(userId);
    if (client) {
        await executeWithHealthCheck(socket, client);
    }
});

export const getCurrentAutomaticInterval = () => currentAutomaticInterval;
export const getAllowedManualIntervals = () => [...ALLOWED_MANUAL_INTERVALS];
export const getConnectedClientsCount = () => connectedClients.size;
export const getAutomaticClientsCount = () =>
    Array.from(connectedClients.values()).filter(client => client.isAutomatic).length;
