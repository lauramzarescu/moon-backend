import {Server, Socket} from 'socket.io';
import {createServer} from 'http';
import express, {Express} from "express";
import {SocketDetailsService} from "../services/socket.service";
import {AuthService} from "../services/auth.service";
import * as cookie from 'cookie'
import {SOCKET_EVENTS} from "../constants/socket-events";

export const app: Express = express();
export const httpServer = createServer(app);
export const io = new Server(httpServer, {
    cors: {
        origin: [
            process.env.APP_URL || 'http://localhost:5173',
            process.env.API_URL || 'http://localhost:3000'
        ],
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ['polling', 'websocket'],
    allowUpgrades: true
});

const socketDetailsService = SocketDetailsService.getInstance();
const connectedClients = new Map();

// Interval management constants
const MIN_INTERVAL = 3;
const MAX_INTERVAL = 120;
const INTERVAL_INCREASE_FACTOR = 2;
const INTERVAL_DECREASE_FACTOR = 0.5;
const HEALTH_CHECK_WINDOW = 5;

let currentInterval = MIN_INTERVAL;
let successfulRequestsCount = 0;

interface AuthenticatedSocket extends Socket {
    userId: string;
    userInfo?: any;
}

const updateAllClientIntervals = (newIntervalTime: number) => {
    console.log(`[INTERVAL] Updating all automatic clients to new interval: ${newIntervalTime} seconds`);
    console.log(`[INTERVAL] Current connected clients: ${connectedClients.size}`);

    connectedClients.forEach((client, userId) => {

        if (client.intervalId) {
            clearInterval(client.intervalId);
            client.intervalTime = newIntervalTime * 1000;

            client.intervalId = setInterval(async () => {
                for (const userSocket of client.sockets) {
                    if (userSocket.connected) {
                        await executeWithHealthCheck(userSocket);
                    }
                }
            }, client.intervalTime);

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
        console.log(`[ERROR] Execute failed: ${error.name}`);
        if (error.name === 'ThrottlingException') {
            increaseInterval();
        }
    }
};

io.use((socket: Socket, next) => {
    try {
        console.log(`[AUTH] New connection attempt from ${socket.id}`);
        const cookieHeader = socket.handshake.headers.cookie;

        if (!cookieHeader) {
            return next(new Error("Authentication required"));
        }

        const cookies = cookie.parse(cookieHeader);

        const token = cookies['token'];

        if (!token) {
            return next(new Error("Authentication token not found"));
        }

        const decoded = AuthService.decodeToken(token);
        const authSocket = socket as AuthenticatedSocket;
        authSocket.userId = decoded.userId;
        authSocket.userInfo = decoded;

        next();
    } catch (error) {
        console.error(`[AUTH] Authentication failed for ${socket.id}:`, error);
        next(new Error("Invalid authentication token"));
    }
});

io.on('connection', async (_socket: Socket) => {
    console.log(`[CONNECTION] New connection from ${_socket.id}`);
    const socket = _socket as AuthenticatedSocket;
    const userId = socket.userId;

    if (!connectedClients.has(userId)) {
        console.log(`[CONNECTION] First connection for user ${userId}`);
        connectedClients.set(userId, {
            sockets: [socket],
            intervalId: null,
            intervalTime: currentInterval * 1000,
            isAutomatic: true
        });
    } else {
        console.log(`[CONNECTION] Additional connection for user ${userId}`);
        const client = connectedClients.get(userId);
        client.sockets.push(socket);
    }

    await socketDetailsService.generateClusterDetails(socket);

    socket.on(SOCKET_EVENTS.INTERVAL_SET, (intervalTime) => {
        const client = connectedClients.get(userId);
        console.log(`[INTERVAL] User ${userId} requested interval change to ${intervalTime}s`);

        if (client) {
            if (client.intervalId) {
                clearInterval(client.intervalId);
            }

            // Handle automatic mode (-1)
            if (intervalTime === -1) {
                client.isAutomatic = true;
                client.intervalTime = MIN_INTERVAL * 1000;
                console.log(`[INTERVAL] Setting automatic mode for user ${userId} starting at ${MIN_INTERVAL}s`);
            } else {
                client.isAutomatic = false;
                client.intervalTime = intervalTime * 1000;
                console.log(`[INTERVAL] Setting manual mode for user ${userId} at ${intervalTime}s`);
            }

            socket.emit(SOCKET_EVENTS.INTERVAL_UPDATED, client.intervalTime)

            if (intervalTime === 0) {
                client.intervalId = null;
                return;
            }

            client.intervalId = setInterval(async () => {
                for (const userSocket of client.sockets) {
                    if (userSocket.connected) {
                        await executeWithHealthCheck(userSocket);
                    }
                }
            }, client.intervalTime);
        }
    });

    socket.on(SOCKET_EVENTS.MANUAL_REFRESH, async () => {
        console.log(`[MANUAL] Manual refresh requested by user ${userId}`);
        if (connectedClients.has(userId)) {
            await socketDetailsService.generateClusterDetails(socket);
        }
    });

    socket.on(SOCKET_EVENTS.CLUSTERS_UPDATE, async () => {
        console.log(`[UPDATE] Cluster update requested by user ${userId}`);
        if (connectedClients.has(userId)) {
            await socketDetailsService.generateClusterDetails(socket);
        }
    });

    socket.on(SOCKET_EVENTS.DISCONNECT, () => {
        console.log(`[DISCONNECT] Socket ${socket.id} disconnecting (User: ${userId})`);
        const client = connectedClients.get(userId);
        if (client) {
            client.sockets = client.sockets.filter((s: Socket) => s.id !== socket.id);

            if (client.sockets.length === 0) {
                console.log(`[DISCONNECT] Cleaning up last connection for user ${userId}`);
                clearInterval(client.intervalId);
                connectedClients.delete(userId);
            } else {
                console.log(`[DISCONNECT] User ${userId} still has ${client.sockets.length} active connections`);
            }
        }
    });
});