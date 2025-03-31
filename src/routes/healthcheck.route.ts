import express from 'express';
import {io} from '../config/socket.config';

const router = express.Router();

router.get('/', (req, res) => {
    const socketStatus = {
        connected: io.sockets.sockets.size,
        rooms: Array.from(io.sockets.adapter.rooms.keys()),
        serverUptime: process.uptime(),
    };

    res.json({
        status: 'success',
        server: 'Healthy',
        socket: socketStatus,
        timestamp: new Date().toISOString(),
    });
});

export default router;
