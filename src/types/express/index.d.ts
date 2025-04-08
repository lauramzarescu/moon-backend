import {User} from '@prisma/client';
import express from 'express';

export interface CustomRequest extends express.Request {
    user?: User;
}

declare global {
    namespace Express {
        interface Request {
            ipAddress?: string;
            user?: import('@prisma/client').User;
        }
    }
}
