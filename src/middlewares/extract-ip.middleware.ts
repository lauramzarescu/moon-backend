import express from 'express';

export const extractIpMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '-';
    // @ts-ignore
    req.ipAddress = Array.isArray(ip) ? ip[0] : ip;
    next();
};
