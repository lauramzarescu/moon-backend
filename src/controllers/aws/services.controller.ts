import express, {Response} from 'express';
import {ECSService} from '../../services/aws/ecs.service';
import {ecsClient} from '../../config/aws.config';
import {serviceRestartSchema, serviceUpdateCountSchema, serviceUpdateImageSchema} from './service.schema';
import {AuditLogEnum} from '../../enums/audit-log/audit-log.enum';
import {AuditLogHelper} from '../audit-log/audit-log.helper';
import {UserRepository} from '../../repositories/user/user.repository';
import {prisma} from '../../config/db.config';
import {User} from '@prisma/client';

export class ServicesController {
    private readonly ecsService: ECSService;
    private readonly auditHelper: AuditLogHelper;
    private readonly userRepository: UserRepository;

    constructor() {
        this.ecsService = new ECSService(ecsClient);
        this.auditHelper = new AuditLogHelper();
        this.userRepository = new UserRepository(prisma);
    }

    public updateServiceDesiredCount = async (req: express.Request, res: Response) => {
        try {
            const {clusterName, serviceName, desiredCount} = serviceUpdateCountSchema.parse(req.body);

            await this.ecsService.updateServiceDesiredCount(clusterName, serviceName, desiredCount);

            res.json({
                message: 'Service desired count updated successfully',
                clusterName,
                serviceName,
                desiredCount,
            });

            const user = res.locals.user as User;
            await this.auditHelper.create({
                userId: user?.id || '-',
                organizationId: user?.organizationId || '-',
                action: AuditLogEnum.AWS_SERVICE_UPDATED,
                details: {
                    ip: (req as any).ipAddress,
                    info: {
                        userAgent: req.headers['user-agent'],
                        email: user?.email || '-',
                        description: `Service ${serviceName} in cluster ${clusterName} updated to desired count ${desiredCount}`,
                    },
                },
            });
        } catch (error: any) {
            const errorResponse = {
                error: 'Failed to update service desired count',
                details: error,
            };
            res.status(500).json(errorResponse);
        }
    };

    public updateServiceContainerImage = async (req: express.Request, res: Response) => {
        try {
            const {clusterName, serviceName, containerName, newImageUri} = serviceUpdateImageSchema.parse(req.body);
            const newTaskDefinitionArn = await this.ecsService.updateServiceContainerImage(
                clusterName,
                serviceName,
                containerName,
                newImageUri
            );

            res.json({
                message: 'Service container image updated successfully',
                clusterName,
                serviceName,
                containerName,
                newImageUri,
                newTaskDefinitionArn,
            });

            const user = res.locals.user as User;
            await this.auditHelper.create({
                userId: user?.id || '-',
                organizationId: user?.organizationId || '-',
                action: AuditLogEnum.AWS_SERVICE_UPDATED,
                details: {
                    ip: (req as any).ipAddress,
                    info: {
                        userAgent: req.headers['user-agent'],
                        email: user?.email || '-',
                        description: `Service ${serviceName} in cluster ${clusterName} updated to new image ${newImageUri}`,

                        service: serviceName,
                        cluster: clusterName,
                        newServiceImage: newImageUri,
                        oldServiceImage: containerName,
                    },
                },
            });
        } catch (error: any) {
            const errorResponse = {
                error: 'Failed to update service container image',
                details: error,
            };
            res.status(500).json(errorResponse);
        }
    };

    public restartService = async (req: express.Request, res: Response) => {
        try {
            const {clusterName, serviceName} = serviceRestartSchema.parse(req.body);
            await this.ecsService.restartService(clusterName, serviceName);

            res.json({
                message: 'Service restarted successfully',
                clusterName,
                serviceName,
            });

            const user = res.locals.user as User;
            await this.auditHelper.create({
                userId: user?.id || '-',
                organizationId: user?.organizationId || '-',
                action: AuditLogEnum.AWS_SERVICE_RESTARTED,
                details: {
                    ip: (req as any).ipAddress,
                    info: {
                        userAgent: req.headers['user-agent'],
                        email: user?.email || '-',
                        description: `Service ${serviceName} in cluster ${clusterName} restarted`,
                    },
                },
            });
        } catch (error: any) {
            const errorResponse = {
                error: 'Failed to restart service',
                details: error,
            };
            res.status(500).json(errorResponse);
        }
    };
}
