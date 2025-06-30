import express from 'express';
import {UserRepository} from '../../repositories/user/user.repository';
import {userCreateSchema, userDetailsResponseSchema, userUpdateSchema} from './user.schema';
import {AuthService} from '../../services/auth.service';
import {UserHelper} from './helper';
import {PaginationHandler} from '../../utils/pagination.util';
import {prisma} from '../../config/db.config';
import bcrypt from 'bcrypt';
import {User} from '@prisma/client';
import {AuditLogEnum} from '../../enums/audit-log/audit-log.enum';
import {AuditLogHelper} from '../audit-log/audit-log.helper';

const TWO_FACTOR_EXPIRATION_DAYS = 21;

export class UserController {
    static userRepository = new UserRepository(prisma);
    static auditHelper = new AuditLogHelper();

    static getUserDetails = async (req: express.Request, res: express.Response) => {
        try {
            const user = res.locals.user as User;

            const me = userDetailsResponseSchema.parse(user);
            me.name = user.name || user.nameID || 'N/A';

            res.json(me);
        } catch (error: any) {
            res.status(500).json({message: error.message});
        }
    };

    static getAll = async (req: express.Request, res: express.Response) => {
        try {
            const users = await this.userRepository.getAll({role: 'asc'});
            res.json(users);
        } catch (error: any) {
            res.status(500).json({message: error.message});
        }
    };

    static getAllPaginated = async (req: express.Request, res: express.Response) => {
        try {
            const token = AuthService.decodeToken(req.headers.authorization);
            const filters = PaginationHandler.translateFilters(req.query, 'user');

            const paginatedUsers = await UserHelper.getAuthorizedPaginated(token.userId, {
                page: Number(req.query.page) || 1,
                limit: Number(req.query.limit) || 50,
                filters,
                orderBy: String(req.query.orderBy || 'createdAt'),
                order: (req.query.order as 'asc' | 'desc') || 'desc',
            });

            res.json(paginatedUsers);
        } catch (error: any) {
            res.status(500).json({message: error.message});
        }
    };

    static getOne = async (req: express.Request, res: express.Response) => {
        try {
            const user = await this.userRepository.getOne(req.params.id);
            res.json(user);
        } catch (error: any) {
            res.status(500).json({message: error.message});
        }
    };

    static create = async (req: express.Request, res: express.Response) => {
        try {
            const requesterUser = res.locals.user as User;
            const validatedData = userCreateSchema.parse(req.body);

            validatedData.organizationId = requesterUser.organizationId;
            validatedData.password = await bcrypt.hash(validatedData.password as string, 10);

            const isDuplicate = await this.userRepository.findOneWhere({
                email: validatedData.email.toLowerCase(),
            });

            if (isDuplicate) {
                res.status(400).json({message: 'Email already exists'});
                return;
            }

            const user = await this.userRepository.create(validatedData);

            res.status(201).json(user);

            await this.auditHelper.create({
                userId: requesterUser?.id || '-',
                organizationId: requesterUser?.organizationId || '-',
                action: AuditLogEnum.USER_CREATED,
                details: {
                    ip: (req as any).ipAddress,
                    info: {
                        userAgent: req.headers['user-agent'],
                        email: requesterUser?.email || '-',
                        description: `User ${user.email} created`,
                        objectNew: user,
                    },
                },
            });
        } catch (error: any) {
            res.status(500).json({message: error.message});
        }
    };

    static update = async (req: express.Request, res: express.Response) => {
        try {
            const requesterUser = res.locals.user as User;
            const validatedData = userUpdateSchema.parse(req.body);
            const user = await this.userRepository.update(req.params.id, validatedData);

            res.json(user);

            await this.auditHelper.create({
                userId: requesterUser?.id || '-',
                organizationId: requesterUser?.organizationId || '-',
                action: AuditLogEnum.USER_UPDATED,
                details: {
                    ip: (req as any).ipAddress,
                    info: {
                        userAgent: req.headers['user-agent'],
                        email: requesterUser?.email || '-',
                        description: `User ${user.email} updated`,
                        objectOld: requesterUser,
                        objectNew: user,
                    },
                },
            });
        } catch (error: any) {
            res.status(500).json({message: error.message});
        }
    };

    static delete = async (req: express.Request, res: express.Response) => {
        try {
            const requesterUser = res.locals.user as User;
            const userToDelete = await this.userRepository.getOne(req.params.id);

            // Prevent self-deletion
            if (requesterUser.id === req.params.id) {
                res.status(400).json({message: 'You cannot delete your own account'});
                return;
            }

            // Ensure user belongs to same organization
            if (userToDelete.organizationId !== requesterUser.organizationId) {
                res.status(403).json({message: 'You can only delete users from your organization'});
                return;
            }

            const deletedUser = await this.userRepository.delete(req.params.id);

            res.json({
                success: true,
                message: 'User deleted successfully',
                user: {
                    id: deletedUser.id,
                    email: deletedUser.email,
                    name: deletedUser.name,
                },
            });

            await this.auditHelper.create({
                userId: requesterUser?.id || '-',
                organizationId: requesterUser?.organizationId || '-',
                action: AuditLogEnum.USER_DELETED,
                details: {
                    ip: (req as any).ipAddress,
                    info: {
                        userAgent: req.headers['user-agent'],
                        email: requesterUser?.email || '-',
                        description: `User ${deletedUser.email} deleted`,
                        objectOld: deletedUser,
                    },
                },
            });
        } catch (error: any) {
            res.status(500).json({message: error.message});
        }
    };
}
