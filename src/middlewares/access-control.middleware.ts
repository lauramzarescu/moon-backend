import {NextFunction, Request, Response} from 'express';
import {UserRole} from '@prisma/client';
import {UserRepository} from '../repositories/user/user.repository';
import {AccessControlHelper} from '../controllers/access-control/helper';
import {UserInput} from '../controllers/user/schemas/user.schema';
import {prisma} from '../config/db.config';
import {SamlConfigRepository} from '../repositories/saml-config/saml-config.repository';
import logger from '../config/logger';

/** Only for login endpoint with SAML */
export const checkAccessControlGuard = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const user = req.user as UserInput;

        if (!user.email) {
            res.status(400).json({error: 'Email is required.'}).redirect('/login');
            return;
        }

        const userRepository = new UserRepository(prisma);
        const accessControlHelper = new AccessControlHelper();

        const requesterUser = await userRepository.findOneWhere({email: user.email});

        const isAllowed = await accessControlHelper.checkAccess(user.email, user.organizationId);
        if (!isAllowed) {
            res.status(403).json({error: 'Access denied.'});
            return;
        }

        next();
    } catch (error: any) {
        logger.error(error);
        res.status(403).json({message: 'Access denied'});
        return;
    }
};

/** Only for login endpoint with password */
export const checkAccessControlPasswordGuard = async (req: Request, res: Response, next: NextFunction) => {
    try {
        let {email} = req.body;
        email = email.toLowerCase();

        const userRepository = new UserRepository(prisma);
        const samlConfigRepository = new SamlConfigRepository(prisma);
        const accessControlHelper = new AccessControlHelper();

        const requesterUser = await userRepository.getOneWhere({email});
        const samlConfig = await samlConfigRepository.findOneWhere({organizationId: requesterUser.organizationId});

        /** Allow root users to bypass access control */
        if (requesterUser.role === UserRole.root) {
            next();
            return;
        }

        /** If the access control list is not empty and a SAML setup is configured, don't allow login with password */
        const isEnabled = await accessControlHelper.isEnabled(requesterUser.organizationId);
        if (isEnabled && samlConfig) {
            res.status(403).json({error: 'Login with password disabled for this organization.'});
            return;
        }

        const isAllowed = await accessControlHelper.checkAccess(email, requesterUser.organizationId);
        if (!isAllowed) {
            res.status(403).json({error: 'Access denied.'});
            return;
        }

        next();
    } catch (error: any) {
        logger.error(error);
        res.status(403).json({message: 'Access denied'});
        return;
    }
};
