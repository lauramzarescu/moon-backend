import express, {Response} from 'express';
import {ECSService} from '../../services/aws/ecs.service';
import {ecsClient} from '../../config/aws.config';
import {
    addEnvironmentVariablesSchema,
    bulkUpdateEnvironmentVariablesSchema,
    bulkUpdateWithVersioningSchema,
    compareVersionsSchema,
    copyVariablesBetweenServicesSchema,
    editEnvironmentVariablesSchema,
    getVariablesFromVersionSchema,
    getVersionsListSchema,
    removeEnvironmentVariablesSchema,
    replaceEnvironmentVariablesSchema,
    rollbackToVersionSchema,
} from './environment-variable.schema';
import {AuditLogEnum} from '../../enums/audit-log/audit-log.enum';
import {AuditLogHelper} from '../audit-log/audit-log.helper';
import {UserRepository} from '../../repositories/user/user.repository';
import {prisma} from '../../config/db.config';
import {User} from '@prisma/client';
import {EnvironmentVariableVersioningService} from '../../services/aws/environment-variable-versioning.service';
import {
    AddEnvironmentVariablesResponse,
    BulkUpdateWithVersioningResponse,
    CompareVersionsResponse,
    CopyVariablesBetweenServicesResponse,
    EditEnvironmentVariablesResponse,
    ErrorResponse,
    GetVariablesFromVersionResponse,
    GetVersionsListResponse,
    RemoveEnvironmentVariablesResponse,
    RollbackToVersionResponse,
} from '../../types/aws/environment-variable-api.types';

export class EnvironmentVariableController {
    private readonly ecsService: ECSService;
    private readonly auditHelper: AuditLogHelper;
    private readonly userRepository: UserRepository;
    private readonly versioningService: EnvironmentVariableVersioningService;

    constructor() {
        this.ecsService = new ECSService(ecsClient);
        this.auditHelper = new AuditLogHelper();
        this.userRepository = new UserRepository(prisma);
        this.versioningService = new EnvironmentVariableVersioningService(ecsClient);
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

            const response: AddEnvironmentVariablesResponse = {
                message: 'Environment variables added successfully',
                clusterName,
                serviceName,
                containerName,
                addedVariables: environmentVariables.length,
                newTaskDefinitionArn,
            };

            res.json(response);

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
            const errorResponse: ErrorResponse = {
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

            const response: EditEnvironmentVariablesResponse = {
                message: 'Environment variables updated successfully',
                clusterName,
                serviceName,
                containerName,
                updatedVariables: environmentVariables.length,
                newTaskDefinitionArn,
            };

            res.json(response);

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
            const errorResponse: ErrorResponse = {
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

            const response: RemoveEnvironmentVariablesResponse = {
                message: 'Environment variables removed successfully',
                clusterName,
                serviceName,
                containerName,
                removedVariables: variableNames.length,
                variableNames,
                newTaskDefinitionArn,
            };

            res.json(response);

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
            const errorResponse: ErrorResponse = {
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

    // New versioning methods

    public getVersionsList = async (req: express.Request, res: Response) => {
        try {
            const {clusterName, serviceName, containerName} = getVersionsListSchema.parse(req.query);

            const versions = await this.versioningService.getEnvironmentVariableVersions(
                clusterName,
                serviceName,
                containerName
            );

            const response: GetVersionsListResponse = {
                message: 'Environment variable versions retrieved successfully',
                clusterName,
                serviceName,
                containerName,
                totalVersions: versions.length,
                versions,
            };

            res.json(response);
        } catch (error: any) {
            const errorResponse: ErrorResponse = {
                error: 'Failed to get environment variable versions',
                details: error.message || error,
            };
            res.status(500).json(errorResponse);
        }
    };

    public getVariablesFromVersion = async (req: express.Request, res: Response) => {
        try {
            const {clusterName, serviceName, containerName, revision} = getVariablesFromVersionSchema.parse(req.query);

            const environmentVariables = await this.versioningService.getEnvironmentVariablesFromVersion(
                clusterName,
                serviceName,
                containerName,
                revision
            );

            const response: GetVariablesFromVersionResponse = {
                message: 'Environment variables from version retrieved successfully',
                clusterName,
                serviceName,
                containerName,
                revision,
                totalVariables: environmentVariables.length,
                environmentVariables,
            };

            res.json(response);
        } catch (error: any) {
            const errorResponse: ErrorResponse = {
                error: 'Failed to get environment variables from version',
                details: error.message || error,
            };
            res.status(500).json(errorResponse);
        }
    };

    public copyVariablesBetweenServices = async (req: express.Request, res: Response) => {
        try {
            const {
                sourceClusterName,
                sourceServiceName,
                sourceContainerName,
                targetClusterName,
                targetServiceName,
                targetContainerName,
                sourceRevision,
            } = copyVariablesBetweenServicesSchema.parse(req.body);

            const newTaskDefinitionArn = await this.versioningService.copyEnvironmentVariablesBetweenServices(
                sourceClusterName,
                sourceServiceName,
                sourceContainerName,
                targetClusterName,
                targetServiceName,
                targetContainerName,
                sourceRevision
            );

            const response: CopyVariablesBetweenServicesResponse = {
                message: 'Environment variables copied successfully',
                source: {
                    clusterName: sourceClusterName,
                    serviceName: sourceServiceName,
                    containerName: sourceContainerName,
                    revision: sourceRevision,
                },
                target: {
                    clusterName: targetClusterName,
                    serviceName: targetServiceName,
                    containerName: targetContainerName,
                },
                newTaskDefinitionArn,
            };

            res.json(response);

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
                        description: `Copied environment variables from ${sourceServiceName}:${sourceContainerName}${sourceRevision ? ` (revision ${sourceRevision})` : ''} to ${targetServiceName}:${targetContainerName}`,
                    },
                },
            });
        } catch (error: any) {
            const errorResponse: ErrorResponse = {
                error: 'Failed to copy environment variables between services',
                details: error.message || error,
            };
            res.status(500).json(errorResponse);
        }
    };

    public rollbackToVersion = async (req: express.Request, res: Response) => {
        try {
            const {clusterName, serviceName, containerName, targetRevision} = rollbackToVersionSchema.parse(req.body);

            const newTaskDefinitionArn = await this.versioningService.rollbackToVersion(
                clusterName,
                serviceName,
                containerName,
                targetRevision
            );

            const response: RollbackToVersionResponse = {
                message: 'Environment variables rolled back successfully',
                clusterName,
                serviceName,
                containerName,
                targetRevision,
                newTaskDefinitionArn,
            };

            res.json(response);

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
                        description: `Rolled back environment variables to revision ${targetRevision} for container ${containerName} in service ${serviceName} (cluster: ${clusterName})`,
                    },
                },
            });
        } catch (error: any) {
            const errorResponse: ErrorResponse = {
                error: 'Failed to rollback environment variables',
                details: error.message || error,
            };
            res.status(500).json(errorResponse);
        }
    };

    public compareVersions = async (req: express.Request, res: Response) => {
        try {
            const {clusterName, serviceName, containerName, revision1, revision2} = compareVersionsSchema.parse(
                req.query
            );

            const comparison = await this.versioningService.compareVersions(
                clusterName,
                serviceName,
                containerName,
                revision1,
                revision2
            );

            const response: CompareVersionsResponse = {
                message: 'Environment variable versions compared successfully',
                clusterName,
                serviceName,
                containerName,
                comparison: {
                    revision1,
                    revision2,
                    ...comparison,
                },
            };

            res.json(response);
        } catch (error: any) {
            const errorResponse: ErrorResponse = {
                error: 'Failed to compare environment variable versions',
                details: error.message || error,
            };
            res.status(500).json(errorResponse);
        }
    };

    public bulkUpdateWithVersioning = async (req: express.Request, res: Response) => {
        try {
            const {clusterName, serviceName, operations} = bulkUpdateWithVersioningSchema.parse(req.body);

            const newTaskDefinitionArn = await this.versioningService.bulkUpdateWithVersioning(
                clusterName,
                serviceName,
                operations ?? []
            );

            const totalVariables = operations.reduce((sum, op) => {
                return sum + (op.environmentVariables?.length || op.variableNames?.length || 0);
            }, 0);

            const response: BulkUpdateWithVersioningResponse = {
                message: 'Environment variables bulk updated with versioning successfully',
                clusterName,
                serviceName,
                containersUpdated: operations.length,
                totalVariables,
                newTaskDefinitionArn,
            };

            res.json(response);

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
                        description: `Bulk updated environment variables for ${operations.length} containers in service ${serviceName} (cluster: ${clusterName})`,
                    },
                },
            });
        } catch (error: any) {
            const errorResponse: ErrorResponse = {
                error: 'Failed to bulk update environment variables with versioning',
                details: error.message || error,
            };
            res.status(500).json(errorResponse);
        }
    };
}
