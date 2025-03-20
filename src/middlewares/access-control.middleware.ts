import {NextFunction, Request, Response} from 'express';
import {UserRole} from "@prisma/client";
import {UserRepository} from "../repositories/user/user.repository";
import {AccessControlHelper} from "../controllers/access-control/helper";
import {UserInput} from "../controllers/user/user.schema";
import {prisma} from "../config/db.config";

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
            return
        }

        next();
    } catch (error) {
        console.log(error)
        res.status(403).json({message: 'Access denied'});
        return;
    }
};

/** Only for login endpoint with password */
export const checkAccessControlPasswordGuard = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const {email} = req.body;

        const userRepository = new UserRepository(prisma);
        const accessControlHelper = new AccessControlHelper();

        const requesterUser = await userRepository.getOneWhere({email});

        /** Allow root users to bypass access control */
        if (requesterUser.role === UserRole.root) {
            next();
            return;
        }

        /** If the access control list is not empty, don't allow login with password */
        const isEnabled = await accessControlHelper.isEnabled(requesterUser.organizationId);
        if (isEnabled) {
            res.status(403).json({error: 'Login with password disabled for this organization.'});
            return;
        }

        next();
    } catch (error) {
        console.log(error)
        res.status(403).json({message: 'Access denied'});
        return;
    }
};
