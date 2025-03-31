import express from 'express';
import {PermissionEnum} from '../enums/rbac/permission.enum';
import {AuthService} from '../services/auth.service';

export const isAuthenticated = (req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.log('checking authentication');
    if (req.isAuthenticated()) {
        console.log('user is authenticated');
        return next();
    }
    console.log('user is not authenticated');
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
                    console.log('invalid token');
                    res.status(401).json({message: 'Invalid token'});
                    return;
                }

                const validPermissions = AuthService.tokenHasPermissions(decoded, permissions);

                if (!validPermissions) {
                    console.log('invalid permissions');
                    res.status(403).json({message: 'Invalid permissions'});
                    return;
                }

                next();
                return;
            } catch (error) {
                console.log('invalid token');
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
