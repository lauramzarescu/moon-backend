import express, {Response} from 'express';
import {ECSService} from '../../services/aws/ecs.service';
import {ecsClient} from '../../config/aws.config';
import {
    addEnvironmentVariablesSchema,
    compareVersionsSchema,
    copyVariablesBetweenServicesSchema,
    editEnvironmentVariablesSchema,
    getVariablesFromVersionSchema,
    getVersionsListSchema,
    moveVariablesBetweenServicesSchema,
    removeEnvironmentVariablesSchema,
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
    CompareVersionsResponse,
    CopyVariablesBetweenServicesResponse,
    EditEnvironmentVariablesResponse,
    ErrorResponse,
    GetVariablesFromVersionResponse,
    GetVersionsListResponse,
    MoveVariablesBetweenServicesResponse,
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
            const {
                clusterName,
                serviceName,
                containerName,
                environmentVariables = [],
                secrets = [],
            } = addEnvironmentVariablesSchema.parse(req.body);

            const result = await this.ecsService.addEnvironmentVariables(
                clusterName,
                serviceName,
                containerName,
                environmentVariables,
                secrets
            );

            const response: AddEnvironmentVariablesResponse = {
                message: 'Environment variables and secrets added successfully',
                clusterName,
                serviceName,
                containerName,
                addedVariables: result.addedVariables,
                addedSecrets: result.addedSecrets,
                newTaskDefinitionArn: result.taskDefinitionArn,
            };

            res.json(response);

            const user = res.locals.user as User;

            if (result.addedVariables > 0) {
                await this.auditHelper.create({
                    userId: user?.id || '-',
                    organizationId: user?.organizationId || '-',
                    action: AuditLogEnum.AWS_SERVICE_ENV_VAR_UPDATED,
                    details: {
                        ip: (req as any).ipAddress,
                        info: {
                            userAgent: req.headers['user-agent'],
                            email: user?.email || '-',
                            description: `Added ${result.addedVariables} environment variables to container ${containerName} in service ${serviceName} (cluster: ${clusterName})`,
                        },
                    },
                });
            }

            if (result.addedSecrets > 0) {
                await this.auditHelper.create({
                    userId: user?.id || '-',
                    organizationId: user?.organizationId || '-',
                    action: AuditLogEnum.AWS_SERVICE_SECRET_UPDATED,
                    details: {
                        ip: (req as any).ipAddress,
                        info: {
                            userAgent: req.headers['user-agent'],
                            email: user?.email || '-',
                            description: `Added ${result.addedSecrets} secrets to container ${containerName} in service ${serviceName} (cluster: ${clusterName})`,
                        },
                    },
                });
            }
        } catch (error: any) {
            const errorResponse: ErrorResponse = {
                error: 'Failed to add environment variables and secrets',
                details: error.message || error,
            };
            res.status(500).json(errorResponse);
        }
    };

    public editEnvironmentVariables = async (req: express.Request, res: Response) => {
        try {
            const {
                clusterName,
                serviceName,
                containerName,
                environmentVariables = [],
                secrets = [],
            } = editEnvironmentVariablesSchema.parse(req.body);

            const result = await this.ecsService.editEnvironmentVariables(
                clusterName,
                serviceName,
                containerName,
                environmentVariables,
                secrets
            );

            const response: EditEnvironmentVariablesResponse = {
                message: 'Environment variables and secrets updated successfully',
                clusterName,
                serviceName,
                containerName,
                updatedVariables: result.updatedVariables,
                updatedSecrets: result.updatedSecrets,
                newTaskDefinitionArn: result.taskDefinitionArn,
            };

            res.json(response);

            const user = res.locals.user as User;

            if (result.updatedVariables > 0) {
                await this.auditHelper.create({
                    userId: user?.id || '-',
                    organizationId: user?.organizationId || '-',
                    action: AuditLogEnum.AWS_SERVICE_ENV_VAR_UPDATED,
                    details: {
                        ip: (req as any).ipAddress,
                        info: {
                            userAgent: req.headers['user-agent'],
                            email: user?.email || '-',
                            description: `Updated ${result.updatedVariables} environment variables in container ${containerName} in service ${serviceName} (cluster: ${clusterName})`,
                        },
                    },
                });
            }

            if (result.updatedSecrets > 0) {
                await this.auditHelper.create({
                    userId: user?.id || '-',
                    organizationId: user?.organizationId || '-',
                    action: AuditLogEnum.AWS_SERVICE_SECRET_UPDATED,
                    details: {
                        ip: (req as any).ipAddress,
                        info: {
                            userAgent: req.headers['user-agent'],
                            email: user?.email || '-',
                            description: `Updated ${result.updatedSecrets} secrets in container ${containerName} in service ${serviceName} (cluster: ${clusterName})`,
                        },
                    },
                });
            }
        } catch (error: any) {
            const errorResponse: ErrorResponse = {
                error: 'Failed to update environment variables and secrets',
                details: error.message || error,
            };
            res.status(500).json(errorResponse);
        }
    };

    public removeEnvironmentVariables = async (req: express.Request, res: Response) => {
        try {
            const {
                clusterName,
                serviceName,
                containerName,
                variableNames = [],
                secretNames = [],
            } = removeEnvironmentVariablesSchema.parse(req.body);

            const result = await this.ecsService.removeEnvironmentVariables(
                clusterName,
                serviceName,
                containerName,
                variableNames,
                secretNames
            );

            const response: RemoveEnvironmentVariablesResponse = {
                message: 'Environment variables and secrets removed successfully',
                clusterName,
                serviceName,
                containerName,
                removedVariables: result.removedVariables,
                removedSecrets: result.removedSecrets,
                variableNames,
                secretNames,
                newTaskDefinitionArn: result.taskDefinitionArn,
            };

            res.json(response);

            const user = res.locals.user as User;

            if (result.removedVariables > 0) {
                await this.auditHelper.create({
                    userId: user?.id || '-',
                    organizationId: user?.organizationId || '-',
                    action: AuditLogEnum.AWS_SERVICE_ENV_VAR_REMOVED,
                    details: {
                        ip: (req as any).ipAddress,
                        info: {
                            userAgent: req.headers['user-agent'],
                            email: user?.email || '-',
                            description: `Removed ${result.removedVariables} environment variables (${variableNames.join(', ')}) from container ${containerName} in service ${serviceName} (cluster: ${clusterName})`,
                        },
                    },
                });
            }

            if (result.removedSecrets > 0) {
                await this.auditHelper.create({
                    userId: user?.id || '-',
                    organizationId: user?.organizationId || '-',
                    action: AuditLogEnum.AWS_SERVICE_SECRET_REMOVED,
                    details: {
                        ip: (req as any).ipAddress,
                        info: {
                            userAgent: req.headers['user-agent'],
                            email: user?.email || '-',
                            description: `Removed ${result.removedSecrets} secrets (${secretNames.join(', ')}) from container ${containerName} in service ${serviceName} (cluster: ${clusterName})`,
                        },
                    },
                });
            }
        } catch (error: any) {
            const errorResponse: ErrorResponse = {
                error: 'Failed to remove environment variables and secrets',
                details: error.message || error,
            };
            res.status(500).json(errorResponse);
        }
    };

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
                variableNames,
            } = copyVariablesBetweenServicesSchema.parse(req.body);

            const copyResult = await this.versioningService.copyEnvironmentVariablesBetweenServices(
                sourceClusterName,
                sourceServiceName,
                sourceContainerName,
                targetClusterName,
                targetServiceName,
                targetContainerName,
                sourceRevision,
                variableNames
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
                newTaskDefinitionArn: copyResult.taskDefinitionArn,
                copiedVariables: {
                    environmentVariables: copyResult.copiedEnvironmentVariables,
                    secrets: copyResult.copiedSecrets,
                    variableNames: variableNames,
                },
            };

            res.json(response);

            const user = res.locals.user as User;

            if (copyResult.copiedEnvironmentVariables > 0) {
                await this.auditHelper.create({
                    userId: user?.id || '-',
                    organizationId: user?.organizationId || '-',
                    action: AuditLogEnum.AWS_SERVICE_ENV_VAR_COPIED,
                    details: {
                        ip: (req as any).ipAddress,
                        info: {
                            userAgent: req.headers['user-agent'],
                            email: user?.email || '-',
                            description: `Copied ${copyResult.copiedEnvironmentVariables} environment variables from ${sourceServiceName}:${sourceContainerName}${sourceRevision ? ` (revision ${sourceRevision})` : ''} to ${targetServiceName}:${targetContainerName}${variableNames ? ` (selected: ${variableNames.join(', ')})` : ' (all)'}`,
                        },
                    },
                });
            }

            if (copyResult.copiedSecrets > 0) {
                await this.auditHelper.create({
                    userId: user?.id || '-',
                    organizationId: user?.organizationId || '-',
                    action: AuditLogEnum.AWS_SERVICE_SECRET_COPIED,
                    details: {
                        ip: (req as any).ipAddress,
                        info: {
                            userAgent: req.headers['user-agent'],
                            email: user?.email || '-',
                            description: `Copied ${copyResult.copiedSecrets} secrets from ${sourceServiceName}:${sourceContainerName}${sourceRevision ? ` (revision ${sourceRevision})` : ''} to ${targetServiceName}:${targetContainerName}${variableNames ? ` (selected: ${variableNames.join(', ')})` : ' (all)'}`,
                        },
                    },
                });
            }
        } catch (error: any) {
            const errorResponse: ErrorResponse = {
                error: 'Failed to copy environment variables between services',
                details: error.message || error,
            };
            res.status(500).json(errorResponse);
        }
    };

    public moveVariablesBetweenServices = async (req: express.Request, res: Response) => {
        try {
            const {
                sourceClusterName,
                sourceServiceName,
                sourceContainerName,
                targetClusterName,
                targetServiceName,
                targetContainerName,
                variableNames,
            } = moveVariablesBetweenServicesSchema.parse(req.body);

            const moveResult = await this.versioningService.moveEnvironmentVariablesBetweenServices(
                sourceClusterName,
                sourceServiceName,
                sourceContainerName,
                targetClusterName,
                targetServiceName,
                targetContainerName,
                variableNames
            );

            const response: MoveVariablesBetweenServicesResponse = {
                message: 'Environment variables moved successfully',
                source: {
                    clusterName: sourceClusterName,
                    serviceName: sourceServiceName,
                    containerName: sourceContainerName,
                },
                target: {
                    clusterName: targetClusterName,
                    serviceName: targetServiceName,
                    containerName: targetContainerName,
                },
                newTaskDefinitionArn: moveResult.taskDefinitionArn,
                movedVariables: {
                    environmentVariables: moveResult.movedEnvironmentVariables,
                    secrets: moveResult.movedSecrets,
                    variableNames: variableNames,
                },
            };

            res.json(response);

            const user = res.locals.user as User;

            if (moveResult.movedEnvironmentVariables > 0) {
                await this.auditHelper.create({
                    userId: user?.id || '-',
                    organizationId: user?.organizationId || '-',
                    action: AuditLogEnum.AWS_SERVICE_ENV_VAR_MOVED,
                    details: {
                        ip: (req as any).ipAddress,
                        info: {
                            userAgent: req.headers['user-agent'],
                            email: user?.email || '-',
                            description: `Moved ${moveResult.movedEnvironmentVariables} environment variables from ${sourceServiceName}:${sourceContainerName} to ${targetServiceName}:${targetContainerName} (variables: ${variableNames.join(', ')})`,
                        },
                    },
                });
            }

            if (moveResult.movedSecrets > 0) {
                await this.auditHelper.create({
                    userId: user?.id || '-',
                    organizationId: user?.organizationId || '-',
                    action: AuditLogEnum.AWS_SERVICE_SECRET_MOVED,
                    details: {
                        ip: (req as any).ipAddress,
                        info: {
                            userAgent: req.headers['user-agent'],
                            email: user?.email || '-',
                            description: `Moved ${moveResult.movedSecrets} secrets from ${sourceServiceName}:${sourceContainerName} to ${targetServiceName}:${targetContainerName} (variables: ${variableNames.join(', ')})`,
                        },
                    },
                });
            }
        } catch (error: any) {
            const errorResponse: ErrorResponse = {
                error: 'Failed to move environment variables between services',
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
                action: AuditLogEnum.AWS_SERVICE_ENV_VAR_VERSION_ROLLED_BACK,
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
}
