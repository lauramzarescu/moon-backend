import express, {NextFunction, Response} from 'express';
import {AuthService} from '../services/auth.service';
import {UserRepository} from '../repositories/user/user.repository';
import {prisma} from '../config/db.config';
import logger from '../config/logger';

export const userInfoMiddleware = async (req: express.Request, res: Response, next: NextFunction) => {
    try {
        if (!req.cookies.token) {
            return next();
        }

        const token = AuthService.decodeToken(req.cookies.token);
        const userRepository = new UserRepository(prisma);

        res.locals.user = await userRepository.getOneWhere({id: token.userId});

        next();
    } catch (error: any) {
        logger.error('Failed to extract user info:', error);
        next(); // Continue anyway to let route handlers handle authentication errors
    }
};
