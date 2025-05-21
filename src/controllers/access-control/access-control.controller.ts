import {Request, Response} from 'express';
import {AccessControlRepository} from '../../repositories/access-control/access-control.repository';
import {accessControlCreateSchema} from './access-control.schema';
import {UserRepository} from '../../repositories/user/user.repository';
import {prisma} from '../../config/db.config';
import {User} from '@prisma/client';
import {AuditLogEnum} from '../../enums/audit-log/audit-log.enum';
import {AuditLogHelper} from '../audit-log/audit-log.helper';
import logger from '../../config/logger';

export class AccessControlController {
    protected repository = new AccessControlRepository(prisma);
    protected userRepository = new UserRepository(prisma);
    protected auditHelper = new AuditLogHelper();

    addToList = async (req: Request, res: Response) => {
        try {
            const {email, description} = req.body;
            const user = res.locals.user as User;

            const validatedData = accessControlCreateSchema.parse({email, description});
            const result = await this.repository.create({
                ...validatedData,
                organizationId: user.organizationId,
                isAllowed: true,
            });

            res.status(201).json(result);

            await this.auditHelper.create({
                userId: user?.id || '-',
                organizationId: user?.organizationId || '-',
                action: AuditLogEnum.ACCESS_CONTROL_CREATED,
                details: {
                    ip: (req as any).ipAddress,
                    info: {
                        userAgent: req.headers['user-agent'],
                        email: user?.email || '-',
                        description: `Access control created for ${email}`,
                        objectNew: result,
                    },
                },
            });
        } catch (error: any) {
            logger.error(error);
            res.status(500).json({message: 'Internal server error'});
        }
    };

    disableAccessControl = async (req: Request, res: Response) => {
        try {
            const user = res.locals.user as User;
            const result = await this.repository.deleteMany({
                organizationId: user.organizationId,
            });

            res.status(200).json({
                message: 'Access control disabled successfully',
                deletedCount: result.count,
            });

            await this.auditHelper.create({
                userId: user?.id || '-',
                organizationId: user?.organizationId || '-',
                action: AuditLogEnum.ACCESS_CONTROL_DELETED,
                details: {
                    ip: (req as any).ipAddress,
                    info: {
                        userAgent: req.headers['user-agent'],
                        email: user?.email || '-',
                        description: `Access control disabled for organization ${user.organizationId}`,
                        objectOld: result,
                    },
                },
            });
        } catch (error: any) {
            logger.info(error);
            res.status(500).json({message: 'Internal server error'});
        }
    };

    removeFromList = async (req: Request, res: Response) => {
        try {
            const {id} = req.params;
            const user = res.locals.user as User;
            const result = await this.repository.delete(id);

            res.status(200).json(result);

            await this.auditHelper.create({
                userId: user?.id || '-',
                organizationId: user?.organizationId || '-',
                action: AuditLogEnum.ACCESS_CONTROL_UPDATED,
                details: {
                    ip: (req as any).ipAddress,
                    info: {
                        userAgent: req.headers['user-agent'],
                        email: user?.email || '-',
                        description: `Access control removed for ${result.email}`,
                        objectOld: result,
                    },
                },
            });
        } catch (error: any) {
            logger.info(error);
            res.status(500).json({message: 'Internal server error'});
        }
    };

    getList = async (req: Request, res: Response) => {
        try {
            const user = res.locals.user as User;
            const result = await this.repository.findMany({organizationId: user.organizationId});

            res.status(200).json(result);
        } catch (error: any) {
            logger.info(error);
            res.status(500).json({message: 'Internal server error'});
        }
    };
}
