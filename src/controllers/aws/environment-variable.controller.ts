import express, {Response} from 'express';
import {ECSService} from '../../services/aws/ecs.service';
import {ecsClient} from '../../config/aws.config';
import {
    addEnvironmentVariablesSchema,
    bulkUpdateEnvironmentVariablesSchema,
    editEnvironmentVariablesSchema,
    removeEnvironmentVariablesSchema,
    replaceEnvironmentVariablesSchema,
} from './environment-variable.schema';
import {AuditLogEnum} from '../../enums/audit-log/audit-log.enum';
import {AuditLogHelper} from '../audit-log/audit-log.helper';
import {UserRepository} from '../../repositories/user/user.repository';
import {prisma} from '../../config/db.config';
import {User} from '@prisma/client';

export class EnvironmentVariableController {
    private readonly ecsService: ECSService;
    private readonly auditHelper: AuditLogHelper;
    private readonly userRepository: UserRepository;

    constructor() {
        this.ecsService = new ECSService(ecsClient);
        this.auditHelper = new AuditLogHelper();
        this.userRepository = new UserRepository(prisma);
    }

    public addEnvironmentVariables = async (req: express.Request, res: Response) => {
        try {
            const {clusterName, serviceName, containerName, environmentVariables} = addEnvironmentVariablesSchema.parse(
                req.body
            );

            const newTaskDefinitionArn = await this.ecsService.addEnvironmentVariables(
                clusterName,
                serviceName,
                containerName,
                environmentVariables
            );

            res.json({
                message: 'Environment variables added successfully',
                clusterName,
                serviceName,
                containerName,
                addedVariables: environmentVariables.length,
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
                        description: `Added ${environmentVariables.length} environment variables to container ${containerName} in service ${serviceName} (cluster: ${clusterName})`,
                    },
                },
            });
        } catch (error: any) {
            const errorResponse = {
                error: 'Failed to add environment variables',
                details: error.message || error,
            };
            res.status(500).json(errorResponse);
        }
    };

    public editEnvironmentVariables = async (req: express.Request, res: Response) => {
        try {
            const {clusterName, serviceName, containerName, environmentVariables} =
                editEnvironmentVariablesSchema.parse(req.body);

            const newTaskDefinitionArn = await this.ecsService.editEnvironmentVariables(
                clusterName,
                serviceName,
                containerName,
                environmentVariables
            );

            res.json({
                message: 'Environment variables updated successfully',
                clusterName,
                serviceName,
                containerName,
                updatedVariables: environmentVariables.length,
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
                        description: `Updated ${environmentVariables.length} environment variables in container ${containerName} in service ${serviceName} (cluster: ${clusterName})`,
                    },
                },
            });
        } catch (error: any) {
            const errorResponse = {
                error: 'Failed to update environment variables',
                details: error.message || error,
            };
            res.status(500).json(errorResponse);
        }
    };

    public removeEnvironmentVariables = async (req: express.Request, res: Response) => {
        try {
            const {clusterName, serviceName, containerName, variableNames} = removeEnvironmentVariablesSchema.parse(
                req.body
            );

            const newTaskDefinitionArn = await this.ecsService.removeEnvironmentVariables(
                clusterName,
                serviceName,
                containerName,
                variableNames
            );

            res.json({
                message: 'Environment variables removed successfully',
                clusterName,
                serviceName,
                containerName,
                removedVariables: variableNames.length,
                variableNames,
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
                        description: `Removed ${variableNames.length} environment variables (${variableNames.join(', ')}) from container ${containerName} in service ${serviceName} (cluster: ${clusterName})`,
                    },
                },
            });
        } catch (error: any) {
            const errorResponse = {
                error: 'Failed to remove environment variables',
                details: error.message || error,
            };
            res.status(500).json(errorResponse);
        }
    };

    public replaceEnvironmentVariables = async (req: express.Request, res: Response) => {
        try {
            const {clusterName, serviceName, containerName, environmentVariables} =
                replaceEnvironmentVariablesSchema.parse(req.body);

            const newTaskDefinitionArn = await this.ecsService.replaceAllEnvironmentVariables(
                clusterName,
                serviceName,
                containerName,
                environmentVariables
            );

            res.json({
                message: 'Environment variables replaced successfully',
                clusterName,
                serviceName,
                containerName,
                totalVariables: environmentVariables.length,
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
                        description: `Replaced all environment variables (${environmentVariables.length} total) in container ${containerName} in service ${serviceName} (cluster: ${clusterName})`,
                    },
                },
            });
        } catch (error: any) {
            const errorResponse = {
                error: 'Failed to replace environment variables',
                details: error.message || error,
            };
            res.status(500).json(errorResponse);
        }
    };

    public bulkUpdateEnvironmentVariables = async (req: express.Request, res: Response) => {
        try {
            const {clusterName, serviceName, operations} = bulkUpdateEnvironmentVariablesSchema.parse(req.body);

            const newTaskDefinitionArn = await this.ecsService.bulkUpdateEnvironmentVariables(
                clusterName,
                serviceName,
                operations
            );

            const totalVariables = operations.reduce((sum, op) => sum + op.environmentVariables.length, 0);

            res.json({
                message: 'Environment variables bulk updated successfully',
                clusterName,
                serviceName,
                containersUpdated: operations.length,
                totalVariables,
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
                        description: `Bulk updated environment variables for ${operations.length} containers (${totalVariables} total variables) in service ${serviceName} (cluster: ${clusterName})`,
                    },
                },
            });
        } catch (error: any) {
            const errorResponse = {
                error: 'Failed to bulk update environment variables',
                details: error.message || error,
            };
            res.status(500).json(errorResponse);
        }
    };
}
