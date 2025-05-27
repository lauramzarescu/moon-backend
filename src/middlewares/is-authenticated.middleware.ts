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
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.substring(7);

            try {
                const decoded = AuthService.decodeToken(token);

                if (!decoded) {
                    logger.info('invalid token');
                    res.status(401).json({message: 'Invalid token'});
                    return;
                }

                const validPermissions = AuthService.tokenHasPermissions(decoded, permissions);

                if (!validPermissions) {
                    logger.info('invalid permissions');
                    res.status(403).json({message: 'Invalid permissions'});
                    return;
                }

                next();
                return;
            } catch (error: any) {
                logger.info('invalid token');
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
