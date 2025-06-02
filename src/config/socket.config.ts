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
const DEFAULT_INTERVAL = 10;
const AUTOMATIC_MIN_INTERVAL = 3;
const AUTOMATIC_MAX_INTERVAL = 120;
const INTERVAL_INCREASE_FACTOR = 2;
const INTERVAL_DECREASE_FACTOR = 0.5;
const HEALTH_CHECK_WINDOW = 5;

let currentInterval = DEFAULT_INTERVAL;
let currentAutomaticInterval = AUTOMATIC_MIN_INTERVAL;
let successfulRequestsCount = 0;

export interface AuthenticatedSocket extends Socket {
    userId: string;
    userInfo?: JwtInterface & {email: string; organizationId: string};
    ipAddress?: string;
}

interface ClientInfo {
    sockets: AuthenticatedSocket[];
    timeoutId: NodeJS.Timeout | null;
    intervalTime: number;
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
            intervalTime: 0,
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

// Update all automatic clients to the new interval
const updateAllClientIntervals = (newIntervalTime: number) => {
    logger.info(`[INTERVAL] Updating all automatic clients to new interval: ${newIntervalTime} seconds`);
    logger.info(
        `[INTERVAL] Current automatic clients: ${Array.from(connectedClients.values()).filter(client => client.isAutomatic).length}`
    );

    connectedClients.forEach((client: ClientInfo, userId) => {
        if (client.isAutomatic && client.timeoutId) {
            clearTimeout(client.timeoutId);
            client.intervalTime = newIntervalTime * 1000;

            scheduleNextExecution(client, userId);

            for (const userSocket of client.sockets) {
                if (userSocket.connected) {
                    userSocket.emit(SOCKET_EVENTS.INTERVAL_UPDATED, {
                        clientInfo: createClientInfoResponse(userId),
                    });
                }
            }
        }
    });
};

const increaseInterval = () => {
    logger.info(`[THROTTLE] Rate limit detected. Current interval: ${currentAutomaticInterval}s`);
    successfulRequestsCount = 0;
    const newInterval = Math.min(currentAutomaticInterval * INTERVAL_INCREASE_FACTOR, AUTOMATIC_MAX_INTERVAL);

    if (newInterval !== currentAutomaticInterval) {
        logger.info(`[THROTTLE] Increasing interval from ${currentAutomaticInterval}s to ${newInterval}s`);
        currentAutomaticInterval = newInterval;
        updateAllClientIntervals(currentAutomaticInterval);
    } else {
        logger.info(`[THROTTLE] Already at maximum interval: ${AUTOMATIC_MAX_INTERVAL}s`);
    }
};

const decreaseInterval = () => {
    logger.info(`[HEALTH] Health check passed. Current interval: ${currentAutomaticInterval}s`);
    successfulRequestsCount = 0;
    const newInterval = Math.max(currentAutomaticInterval * INTERVAL_DECREASE_FACTOR, AUTOMATIC_MIN_INTERVAL);

    if (newInterval !== currentAutomaticInterval) {
        logger.info(`[HEALTH] Decreasing interval from ${currentAutomaticInterval}s to ${newInterval}s`);
        currentAutomaticInterval = newInterval;
        updateAllClientIntervals(currentAutomaticInterval);
    } else {
        logger.info(`[HEALTH] Already at minimum interval: ${AUTOMATIC_MIN_INTERVAL}s`);
    }
};

const executeWithHealthCheck = async (socket: AuthenticatedSocket, client: ClientInfo) => {
    try {
        if (client.useProgressiveLoading) {
            await socketDetailsService.generateClusterDetailsProgressive(socket);
        } else {
            await socketDetailsService.generateClusterDetails(socket);
        }

        if (client.isAutomatic) {
            successfulRequestsCount++;
            if (successfulRequestsCount >= HEALTH_CHECK_WINDOW) {
                decreaseInterval();
            }
        }
    } catch (error: any) {
        logger.error(`[ERROR] Execute failed: ${error.message}`);

        successfulRequestsCount = 0;

        increaseInterval();

        // if (error.message?.toLowerCase().includes('exceeded') || error.message?.toLowerCase().includes('throttling')) {
        // }

        socket.emit('clusters-error', {
            error: 'Failed to fetch cluster information',
            details: error,
            clientInfo: createClientInfoResponse(socket.userId),
        });
    }
};

const scheduleNextExecution = (client: ClientInfo, userId: string) => {
    client.timeoutId = setTimeout(async () => {
        client.isExecuting = true;

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

            if (connectedClients.has(userId) && client.intervalTime > 0) {
                scheduleNextExecution(client, userId);
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
            intervalTime: currentInterval,
            isAutomatic: false,
            useProgressiveLoading: false,
        };
        connectedClients.set(userId, clientInfo);
    } else {
        logger.info(`[CONNECTION] Additional connection for user ${userId}`);
        const client = connectedClients.get(userId);
        client.sockets.push(socket);
    }

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

    socket.on(SOCKET_EVENTS.INTERVAL_SET, intervalTime => {
        const client = connectedClients.get(userId);
        logger.info(`[INTERVAL] User ${userId} requested interval change to ${intervalTime}s`);

        if (client) {
            if (client.timeoutId) {
                clearTimeout(client.timeoutId);
                client.timeoutId = null;
            }

            // Handle automatic mode (-1)
            if (intervalTime === -1) {
                client.isAutomatic = true;
                client.intervalTime = currentAutomaticInterval * 1000;
                logger.info(
                    `[INTERVAL] Setting automatic mode for user ${userId} starting at ${currentAutomaticInterval}s`
                );
            } else {
                client.isAutomatic = false;
                client.intervalTime = intervalTime * 1000;
                logger.info(`[INTERVAL] Setting manual mode for user ${userId} at ${intervalTime}s`);
            }

            const clientInfoResponse = createClientInfoResponse(userId);
            socket.emit(SOCKET_EVENTS.INTERVAL_UPDATED, {
                clientInfo: clientInfoResponse,
            });

            if (intervalTime === 0) {
                return;
            }

            scheduleNextExecution(client, userId);
        }
    });

    socket.on(SOCKET_EVENTS.MANUAL_REFRESH, async () => {
        logger.info(`[MANUAL] Manual refresh requested by user ${userId}`);
        if (connectedClients.has(userId)) {
            const client = connectedClients.get(userId);
            await executeWithHealthCheck(socket, client);
        }
    });

    socket.on(SOCKET_EVENTS.CLUSTERS_UPDATE, async () => {
        logger.info(`[UPDATE] Cluster update requested by user ${userId}`);
        if (connectedClients.has(userId)) {
            const client = connectedClients.get(userId);
            await executeWithHealthCheck(socket, client);
        }
    });

    socket.on(SOCKET_EVENTS.DISCONNECT, () => {
        logger.info(`[DISCONNECT] Socket ${socket.id} disconnecting (User: ${userId})`);
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

    // Start with progressive loading by default
    const client = connectedClients.get(userId);
    await executeWithHealthCheck(socket, client);
});
