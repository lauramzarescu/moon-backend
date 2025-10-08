import express from 'express';
import {PermissionEnum} from '../enums/rbac/permission.enum';
import {AuthService} from '../services/auth.service';
import logger from '../config/logger';

export const isAuthenticated = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    logger.info('checking authentication');
    if (req.isAuthenticated()) {
        logger.info('user is authenticated');
        return next();
    }
    logger.info('user is not authenticated');
    res.redirect('/auth/saml/login');
};

export const isAuthenticatedGuard = (permissions: PermissionEnum[] = []) => {
    return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
        let token: string | undefined;

        // Check Authorization header first
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.substring(7);
        }

        logger.info('[DEBUG] checking authentication');

        // If no header, check cookie
        if (!token && req.cookies && req.cookies.token) {
            token = req.cookies.token;
        }

        logger.info('[DEBUG] token');

        if (token) {
            try {
                const decoded = AuthService.decodeToken(token);

                if (!decoded) {
                    logger.info('[DEBUG] no decoded token');
                    res.status(401).json({message: 'Invalid token'});
                    return;
                }

                const validPermissions = AuthService.tokenHasPermissions(decoded, permissions);

                if (!validPermissions) {
                    res.status(403).json({message: 'Invalid permissions'});
                    return;
                }

                logger.info('[DEBUG] valid permissions');

                next();
                return;
            } catch (error: any) {
                logger.info('[DEBUG] error decoding token');
                res.status(401).json({message: 'Invalid token'});
                return;
            }
        }

        // Check session authentication if no valid token
        if (req.isAuthenticated()) {
            next();
            return;
        }

        res.status(401).json({message: 'Unauthorized'});
    };
};
