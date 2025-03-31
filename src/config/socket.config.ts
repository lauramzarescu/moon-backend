import {Server, Socket} from 'socket.io';
import {createServer} from 'http';
import express, {Express} from 'express';
import {SocketDetailsService} from '../services/socket.service';
import {AuthService} from '../services/auth.service';
import * as cookie from 'cookie';
import {SOCKET_EVENTS} from '../constants/socket-events';

export const app: Express = express();
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

// Interval management constants
const MIN_INTERVAL = 3;
const MAX_INTERVAL = 120;
const INTERVAL_INCREASE_FACTOR = 2;
const INTERVAL_DECREASE_FACTOR = 1;
const HEALTH_CHECK_WINDOW = 5;

let currentInterval = MIN_INTERVAL;
let successfulRequestsCount = 0;

interface AuthenticatedSocket extends Socket {
    userId: string;
    userInfo?: any;
}

interface ClientInfo {
    sockets: AuthenticatedSocket[];
    timeoutId: NodeJS.Timeout | null;
    intervalTime: number;
    isAutomatic: boolean;
    isExecuting?: boolean;
}

const updateAllClientIntervals = (newIntervalTime: number) => {
    console.log(`[INTERVAL] Updating all automatic clients to new interval: ${newIntervalTime} seconds`);
    console.log(`[INTERVAL] Current connected clients: ${connectedClients.size}`);

    connectedClients.forEach((client: ClientInfo, userId) => {
        if (client.timeoutId) {
            clearTimeout(client.timeoutId);
            client.intervalTime = newIntervalTime * 1000;

            scheduleNextExecution(client, userId);

            for (const userSocket of client.sockets) {
                if (userSocket.connected) {
                    userSocket.emit(SOCKET_EVENTS.INTERVAL_UPDATED, newIntervalTime);
                }
            }
        }
    });
};

const increaseInterval = () => {
    console.log(`[THROTTLE] Rate limit detected. Current interval: ${currentInterval}s`);
    successfulRequestsCount = 0;
    const newInterval = Math.min(currentInterval * INTERVAL_INCREASE_FACTOR, MAX_INTERVAL);

    if (newInterval !== currentInterval) {
        console.log(`[THROTTLE] Increasing interval from ${currentInterval}s to ${newInterval}s`);
        currentInterval = newInterval;
        updateAllClientIntervals(currentInterval);
    } else {
        console.log(`[THROTTLE] Already at maximum interval: ${MAX_INTERVAL}s`);
    }
};

const decreaseInterval = () => {
    console.log(`[HEALTH] Health check passed. Current interval: ${currentInterval}s`);
    const newInterval = Math.max(currentInterval * INTERVAL_DECREASE_FACTOR, MIN_INTERVAL);

    if (newInterval !== currentInterval) {
        console.log(`[HEALTH] Decreasing interval from ${currentInterval}s to ${newInterval}s`);
        currentInterval = newInterval;
        updateAllClientIntervals(currentInterval);
    } else {
        console.log(`[HEALTH] Already at minimum interval: ${MIN_INTERVAL}s`);
    }
};

const executeWithHealthCheck = async (socket: AuthenticatedSocket) => {
    try {
        await socketDetailsService.generateClusterDetails(socket);
        successfulRequestsCount++;

        if (successfulRequestsCount >= HEALTH_CHECK_WINDOW) {
            decreaseInterval();
        }
    } catch (error: any) {
        console.log(`[ERROR] Execute failed: ${error.message}`);
        if (error.message?.toLowerCase().includes('exceeded') || error.message?.toLowerCase().includes('throttling')) {
            increaseInterval();
        }

        socket.emit('clusters-error', {
            error: 'Failed to fetch cluster information',
            details: error,
        });
    }
};

const scheduleNextExecution = (client: ClientInfo, userId: string) => {
    client.timeoutId = setTimeout(async () => {
        client.isExecuting = true;

        try {
            console.log(`[EXECUTION] Executing for user ${userId}`);

            for (const userSocket of client.sockets) {
                if (userSocket.connected) {
                    await executeWithHealthCheck(userSocket);
                }
            }
        } catch (error) {
            console.error(`[ERROR] Error during execution for user ${userId}:`, error);
        } finally {
            client.isExecuting = false;

            if (connectedClients.has(userId) && client.intervalTime > 0) {
                scheduleNextExecution(client, userId);
            }
        }
    }, client.intervalTime);
};

io.use((socket: Socket, next) => {
    try {
        console.log(`[AUTH] New connection attempt from ${socket.id}`);
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
        authSocket.userId = decoded.userId;
        authSocket.userInfo = decoded;

        next();
    } catch (error) {
        console.error(`[AUTH] Authentication failed for ${socket.id}:`, error);
        next(new Error('Invalid authentication token'));
    }
});

io.on('connection', async (_socket: Socket) => {
    console.log(`[CONNECTION] New connection from ${_socket.id}`);
    const socket = _socket as AuthenticatedSocket;
    const userId = socket.userId;

    if (!connectedClients.has(userId)) {
        console.log(`[CONNECTION] First connection for user ${userId}`);
        const clientInfo: ClientInfo = {
            sockets: [socket],
            timeoutId: null,
            intervalTime: currentInterval * 1000,
            isAutomatic: true,
        };
        connectedClients.set(userId, clientInfo);
    } else {
        console.log(`[CONNECTION] Additional connection for user ${userId}`);
        const client = connectedClients.get(userId);
        client.sockets.push(socket);
    }

    socket.on(SOCKET_EVENTS.INTERVAL_SET, intervalTime => {
        const client = connectedClients.get(userId);
        console.log(`[INTERVAL] User ${userId} requested interval change to ${intervalTime}s`);

        if (client) {
            if (client.timeoutId) {
                clearTimeout(client.timeoutId);
                client.timeoutId = null;
            }

            // Handle automatic mode (-1)
            if (intervalTime === -1) {
                client.isAutomatic = true;
                client.intervalTime = currentInterval * 1000;
                console.log(`[INTERVAL] Setting automatic mode for user ${userId} starting at ${currentInterval}s`);
            } else {
                client.isAutomatic = false;
                client.intervalTime = intervalTime * 1000;
                console.log(`[INTERVAL] Setting manual mode for user ${userId} at ${intervalTime}s`);
            }

            socket.emit(SOCKET_EVENTS.INTERVAL_UPDATED, client.intervalTime / 1000);

            if (intervalTime === 0) {
                return;
            }

            scheduleNextExecution(client, userId);
        }
    });

    socket.on(SOCKET_EVENTS.MANUAL_REFRESH, async () => {
        console.log(`[MANUAL] Manual refresh requested by user ${userId}`);
        if (connectedClients.has(userId)) {
            await executeWithHealthCheck(socket);
        }
    });

    socket.on(SOCKET_EVENTS.CLUSTERS_UPDATE, async () => {
        console.log(`[UPDATE] Cluster update requested by user ${userId}`);
        if (connectedClients.has(userId)) {
            await executeWithHealthCheck(socket);
        }
    });

    socket.on(SOCKET_EVENTS.DISCONNECT, () => {
        console.log(`[DISCONNECT] Socket ${socket.id} disconnecting (User: ${userId})`);
        const client = connectedClients.get(userId);
        if (client) {
            client.sockets = client.sockets.filter((s: Socket) => s.id !== socket.id);

            if (client.sockets.length === 0) {
                console.log(`[DISCONNECT] Cleaning up last connection for user ${userId}`);
                if (client.timeoutId) {
                    clearTimeout(client.timeoutId);
                }
                connectedClients.delete(userId);
            } else {
                console.log(`[DISCONNECT] User ${userId} still has ${client.sockets.length} active connections`);
            }
        }
    });

    await executeWithHealthCheck(socket);
});
