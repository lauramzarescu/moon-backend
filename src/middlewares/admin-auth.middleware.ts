import {NextFunction, Request, Response} from 'express';
import {UserRole} from "@prisma/client";
import {AuthService} from "../services/auth.service";
import {UserRepository} from "../repositories/user/user.repository";
import {prisma} from "../config/db.config";

export const requireOrganizationAdminGuard = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const userRepository = new UserRepository(prisma);

        const token = AuthService.decodeToken(req.headers.authorization);
        const requesterUser = await userRepository.getOneWhere({id: token.userId});

        const targetUser = await userRepository.getOneWhere(req.params.userId);

        if (requesterUser.role === UserRole.admin || requesterUser.role === UserRole.root) {
            res.status(403).json({message: 'Admin access required'});
            return;
        }

        if (requesterUser.organizationId.toString() !== targetUser.organizationId.toString()) {
            res.status(403).json({message: 'Cannot manage users from different organizations'});
            return;
        }

        next();
    } catch (error) {
        res.status(403).json({message: 'Admin access required'});
        return;
    }
};
