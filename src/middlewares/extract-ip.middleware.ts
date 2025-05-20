import express from 'express';

export const extractIpMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '-';
    // @ts-ignore
    req.ipAddress =
        (typeof req.headers['x-forwarded-for'] === 'string'
            ? (req.headers['x-forwarded-for'] as string).split(',')[0]?.trim()
            : Array.isArray(req.headers['x-forwarded-for'])
              ? req.headers['x-forwarded-for'][0]?.split(',')[0]?.trim()
              : undefined) ||
        (req.headers['x-real-ip'] as string) ||
        (req.headers['cf-connecting-ip'] as string);

    next();
};
