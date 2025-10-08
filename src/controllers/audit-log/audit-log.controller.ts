import express from 'express';
import {AuditLog} from './audit-log.schema';
import {AuditLogHelper} from './audit-log.helper';
import logger from '../../config/logger';
import {AuditLogRepository} from '../../repositories/audit-log/audit-log.repository';
import {prisma} from '../../config/db.config';
import {User, UserRole} from '@prisma/client';
import {PaginationHandler} from '../../utils/pagination.util';

export class AuditLogController {
    static readonly auditHelper = new AuditLogHelper();
    static readonly auditRepository = new AuditLogRepository(prisma);

    constructor() {}

    static async list(req: express.Request, res: express.Response, next: express.NextFunction) {
        try {
            const requesterUser = res.locals.user as User;
            const condition =
                requesterUser.role === UserRole.user
                    ? {userId: requesterUser.id}
                    : {organizationId: requesterUser.organizationId};

            const auditLogs = (await this.auditRepository.getMany(condition)) as AuditLog[];

            res.status(200).json(auditLogs);
        } catch (error: any) {
            logger.error('Error listing audit logs:', error);
            res.status(500).json({error: 'List audit logs failed'});
        }
    }

    static getAllPaginated = async (req: express.Request, res: express.Response) => {
        try {
            const requesterUser = res.locals.user as User;
            const tz = req.query.tz?.toString() || 'UTC';
            const filters = PaginationHandler.translateFilters(req.query, 'auditLog');

            const paginatedUsers = await this.auditHelper.getAuthorizedPaginated(requesterUser, {
                page: Number(req.query.page) || 1,
                limit: Number(req.query.limit) || 50,
                filters,
                tz,
                orderBy: String(req.query.orderBy || 'createdAt'),
                order: (req.query.order as 'asc' | 'desc') || 'desc',
            });

            res.json(paginatedUsers);
        } catch (error: any) {
            logger.error(error);
            res.status(500).json({message: error.message});
        }
    };
}
