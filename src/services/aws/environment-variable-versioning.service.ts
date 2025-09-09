import {ECSClient} from '@aws-sdk/client-ecs';
import {TaskDefinitionService} from './task-definition.service';
import {EnvironmentVariableService} from './environment-variable.service';
import {EnvironmentVariable, Secret} from '../../interfaces/aws-entities/environment-variable.interface';
import logger from '../../config/logger';
import {
    BulkOperation,
    EnvironmentVariableVersion,
    VariableChange,
} from '../../types/aws/environment-variable-api.types';
import {BulkOperationType, ComparisonStatus} from '../../enums/environment-variable/environment-variable.enum';

export interface ServiceEnvironmentVariables {
    clusterName: string;
    serviceName: string;
    containerName: string;
    environmentVariables: EnvironmentVariable[];
}

export class EnvironmentVariableVersioningService {
    private readonly ecsClient: ECSClient;
    private readonly taskDefinitionService: TaskDefinitionService;
    private readonly environmentVariableService: EnvironmentVariableService;

    constructor(ecsClient: ECSClient) {
        this.ecsClient = ecsClient;
        this.taskDefinitionService = new TaskDefinitionService(ecsClient);
        this.environmentVariableService = new EnvironmentVariableService(ecsClient);
    }

    /**
     * Get environment variable versions for a service container with pagination
     */
    public async getEnvironmentVariableVersions(
        clusterName: string,
        serviceName: string,
        containerName: string,
        page: number = 1,
        limit: number = 10
    ): Promise<{
        versions: EnvironmentVariableVersion[];
        totalVersions: number;
        pagination: {
            page: number;
            limit: number;
            totalPages: number;
            hasNextPage: boolean;
            hasPreviousPage: boolean;
        };
    }> {
        logger.info(
            `[EnvVarVersioning] Getting environment variable versions for service: ${serviceName}, container: ${containerName} (page: ${page}, limit: ${limit})`
        );

        const allVersions = await this.taskDefinitionService.getTaskDefinitionVersionsForService(
            clusterName,
            serviceName
        );

        const totalVersions = allVersions.length;
        const totalPages = Math.ceil(totalVersions / limit);
        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + limit;

        const pageVersions = allVersions.slice(startIndex, endIndex);

        const versionsWithEnvVars = await Promise.all(
            pageVersions.map(async version => {
                try {
                    const taskDefResponse = await this.taskDefinitionService.getTaskDefinition(version.arn);
                    const containerDef = taskDefResponse.taskDefinition?.containerDefinitions?.find(
                        container => container.name === containerName
                    );

                    const environmentVariables: EnvironmentVariable[] =
                        containerDef?.environment?.map(env => ({
                            name: env.name || '',
                            value: env.value || '',
                        })) || [];

                    return {
                        ...version,
                        environmentVariables,
                    };
                } catch (error) {
                    logger.warn(
                        `[EnvVarVersioning] Failed to get environment variables for revision ${version.revision}: ${error}`
                    );
                    return {
                        ...version,
                        environmentVariables: [],
                    };
                }
            })
        );

        return {
            versions: versionsWithEnvVars,
            totalVersions,
            pagination: {
                page,
                limit,
                totalPages,
                hasNextPage: page < totalPages,
                hasPreviousPage: page > 1,
            },
        };
    }

    /**
     * Get environment variables from a specific version/revision
     */
    public async getEnvironmentVariablesFromVersion(
        clusterName: string,
        serviceName: string,
        containerName: string,
        revision: number
    ): Promise<EnvironmentVariable[]> {
        logger.info(
            `[EnvVarVersioning] Getting environment variables from revision ${revision} for service: ${serviceName}, container: ${containerName}`
        );

        const versions = await this.taskDefinitionService.getTaskDefinitionVersionsForService(clusterName, serviceName);
        const targetVersion = versions.find(v => v.revision === revision);

        if (!targetVersion) {
            throw new Error(`Revision ${revision} not found for service ${serviceName} in cluster ${clusterName}`);
        }

        const taskDefResponse = await this.taskDefinitionService.getTaskDefinition(targetVersion.arn);
        const containerDef = taskDefResponse.taskDefinition?.containerDefinitions?.find(
            container => container.name === containerName
        );

        if (!containerDef) {
            throw new Error(`Container ${containerName} not found in revision ${revision}`);
        }

        return (
            containerDef.environment?.map(env => ({
                name: env.name || '',
                value: env.value || '',
            })) || []
        );
    }

    /**
     * Get secrets from a specific version/revision
     */
    public async getSecretsFromVersion(
        clusterName: string,
        serviceName: string,
        containerName: string,
        revision: number
    ): Promise<Secret[]> {
        logger.info(
            `[EnvVarVersioning] Getting secrets from revision ${revision} for service: ${serviceName}, container: ${containerName}`
        );

        const versions = await this.taskDefinitionService.getTaskDefinitionVersionsForService(clusterName, serviceName);
        const targetVersion = versions.find(v => v.revision === revision);

        if (!targetVersion) {
            throw new Error(`Revision ${revision} not found for service ${serviceName} in cluster ${clusterName}`);
        }

        const taskDefResponse = await this.taskDefinitionService.getTaskDefinition(targetVersion.arn);
        const containerDef = taskDefResponse.taskDefinition?.containerDefinitions?.find(
            container => container.name === containerName
        );

        if (!containerDef) {
            throw new Error(`Container ${containerName} not found in revision ${revision}`);
        }

        return (
            containerDef.secrets?.map(secret => ({
                name: secret.name || '',
                valueFrom: secret.valueFrom || '',
            })) || []
        );
    }

    /**
     * Copy environment variables from one service to another
     */
    public async copyEnvironmentVariablesBetweenServices(
        sourceClusterName: string,
        sourceServiceName: string,
        sourceContainerName: string,
        targetClusterName: string,
        targetServiceName: string,
        targetContainerName: string,
        sourceRevision?: number,
        variableNames?: string[]
    ): Promise<{
        taskDefinitionArn: string;
        copiedEnvironmentVariables: number;
        copiedSecrets: number;
    }> {
        logger.info(
            `[EnvVarVersioning] Copying environment variables from ${sourceServiceName}:${sourceContainerName} to ${targetServiceName}:${targetContainerName}${variableNames ? ` (selected: ${variableNames.join(', ')})` : ' (all)'}`
        );

        let sourceEnvVars: EnvironmentVariable[];
        let sourceSecrets: Secret[];

        if (sourceRevision) {
            sourceEnvVars = await this.getEnvironmentVariablesFromVersion(
                sourceClusterName,
                sourceServiceName,
                sourceContainerName,
                sourceRevision
            );
            sourceSecrets = await this.getSecretsFromVersion(
                sourceClusterName,
                sourceServiceName,
                sourceContainerName,
                sourceRevision
            );
        } else {
            sourceEnvVars = await this.environmentVariableService.getServiceEnvironmentVariables(
                sourceClusterName,
                sourceServiceName,
                sourceContainerName
            );
            sourceSecrets = await this.environmentVariableService.getServiceSecrets(
                sourceClusterName,
                sourceServiceName,
                sourceContainerName
            );
        }

        // If specific variable names are provided, filter the variables
        if (variableNames && variableNames.length > 0) {
            const variableNamesSet = new Set(variableNames);

            // Check if all requested variables exist in source
            const allSourceVariableNames = new Set([
                ...sourceEnvVars.map(env => env.name),
                ...sourceSecrets.map(secret => secret.name),
            ]);

            const missingVariables = variableNames.filter(name => !allSourceVariableNames.has(name));
            if (missingVariables.length > 0) {
                throw new Error(`Variables not found in source service: ${missingVariables.join(', ')}`);
            }

            // Filter environment variables and secrets
            sourceEnvVars = sourceEnvVars.filter(env => variableNamesSet.has(env.name));
            sourceSecrets = sourceSecrets.filter(secret => variableNamesSet.has(secret.name));
        }

        if (sourceEnvVars.length === 0 && sourceSecrets.length === 0) {
            throw new Error('No environment variables or secrets found to copy');
        }

        // Get current target variables to preserve those not being replaced
        const currentTargetEnvVars = await this.environmentVariableService.getServiceEnvironmentVariables(
            targetClusterName,
            targetServiceName,
            targetContainerName
        );
        const currentTargetSecrets = await this.environmentVariableService.getServiceSecrets(
            targetClusterName,
            targetServiceName,
            targetContainerName
        );

        let finalEnvVars: EnvironmentVariable[];
        let finalSecrets: Secret[];

        if (variableNames && variableNames.length > 0) {
            // Selective copy: merge with existing variables
            const variableNamesSet = new Set(variableNames);

            // Keep existing variables that are not being replaced
            finalEnvVars = [...currentTargetEnvVars.filter(env => !variableNamesSet.has(env.name)), ...sourceEnvVars];

            finalSecrets = [
                ...currentTargetSecrets.filter(secret => !variableNamesSet.has(secret.name)),
                ...sourceSecrets,
            ];
        } else {
            // Copy all: replace everything
            finalEnvVars = sourceEnvVars;
            finalSecrets = sourceSecrets;
        }

        const taskDefinitionArn = await this.environmentVariableService.replaceEnvironmentVariablesAndSecrets(
            targetClusterName,
            targetServiceName,
            targetContainerName,
            finalEnvVars,
            finalSecrets
        );

        return {
            taskDefinitionArn,
            copiedEnvironmentVariables: sourceEnvVars.length,
            copiedSecrets: sourceSecrets.length,
        };
    }

    /**
     * Move environment variables from one service to another (copy + delete from source)
     */
    public async moveEnvironmentVariablesBetweenServices(
        sourceClusterName: string,
        sourceServiceName: string,
        sourceContainerName: string,
        targetClusterName: string,
        targetServiceName: string,
        targetContainerName: string,
        variableNames: string[]
    ): Promise<{
        taskDefinitionArn: string;
        movedEnvironmentVariables: number;
        movedSecrets: number;
    }> {
        logger.info(
            `[EnvVarVersioning] Moving environment variables from ${sourceServiceName}:${sourceContainerName} to ${targetServiceName}:${targetContainerName} (variables: ${variableNames.join(', ')})`
        );

        // Get source variables and secrets
        const sourceEnvVars = await this.environmentVariableService.getServiceEnvironmentVariables(
            sourceClusterName,
            sourceServiceName,
            sourceContainerName
        );
        const sourceSecrets = await this.environmentVariableService.getServiceSecrets(
            sourceClusterName,
            sourceServiceName,
            sourceContainerName
        );

        // Validate that all requested variables exist in source
        const variableNamesSet = new Set(variableNames);
        const allSourceVariableNames = new Set([
            ...sourceEnvVars.map(env => env.name),
            ...sourceSecrets.map(secret => secret.name),
        ]);

        const missingVariables = variableNames.filter(name => !allSourceVariableNames.has(name));
        if (missingVariables.length > 0) {
            throw new Error(`Variables not found in source service: ${missingVariables.join(', ')}`);
        }

        // Filter variables to move
        const varsToMove = sourceEnvVars.filter(env => variableNamesSet.has(env.name));
        const secretsToMove = sourceSecrets.filter(secret => variableNamesSet.has(secret.name));

        if (varsToMove.length === 0 && secretsToMove.length === 0) {
            throw new Error('No environment variables or secrets found to move');
        }

        // Get current target variables to merge with
        const currentTargetEnvVars = await this.environmentVariableService.getServiceEnvironmentVariables(
            targetClusterName,
            targetServiceName,
            targetContainerName
        );
        const currentTargetSecrets = await this.environmentVariableService.getServiceSecrets(
            targetClusterName,
            targetServiceName,
            targetContainerName
        );

        // Merge with existing target variables (replace if exists, add if new)
        const finalTargetEnvVars = [
            ...currentTargetEnvVars.filter(env => !variableNamesSet.has(env.name)),
            ...varsToMove,
        ];

        const finalTargetSecrets = [
            ...currentTargetSecrets.filter(secret => !variableNamesSet.has(secret.name)),
            ...secretsToMove,
        ];

        // Update target service with moved variables
        const targetTaskDefArn = await this.environmentVariableService.replaceEnvironmentVariablesAndSecrets(
            targetClusterName,
            targetServiceName,
            targetContainerName,
            finalTargetEnvVars,
            finalTargetSecrets
        );

        // Remove variables from source service
        const remainingSourceEnvVars = sourceEnvVars.filter(env => !variableNamesSet.has(env.name));
        const remainingSourceSecrets = sourceSecrets.filter(secret => !variableNamesSet.has(secret.name));

        await this.environmentVariableService.replaceEnvironmentVariablesAndSecrets(
            sourceClusterName,
            sourceServiceName,
            sourceContainerName,
            remainingSourceEnvVars,
            remainingSourceSecrets
        );

        return {
            taskDefinitionArn: targetTaskDefArn,
            movedEnvironmentVariables: varsToMove.length,
            movedSecrets: secretsToMove.length,
        };
    }

    /**
     * Rollback environment variables to a specific version
     */
    public async rollbackToVersion(
        clusterName: string,
        serviceName: string,
        containerName: string,
        targetRevision: number
    ): Promise<string> {
        logger.info(
            `[EnvVarVersioning] Rolling back environment variables to revision ${targetRevision} for service: ${serviceName}, container: ${containerName}`
        );

        const envVars = await this.getEnvironmentVariablesFromVersion(
            clusterName,
            serviceName,
            containerName,
            targetRevision
        );

        return await this.environmentVariableService.replaceAllEnvironmentVariables(
            clusterName,
            serviceName,
            containerName,
            envVars
        );
    }

    /**
     * Compare environment variables between two versions
     */
    public async compareVersions(
        clusterName: string,
        serviceName: string,
        containerName: string,
        revision1: number,
        revision2: number
    ): Promise<{
        added: EnvironmentVariable[];
        removed: EnvironmentVariable[];
        modified: VariableChange[];
        unchanged: EnvironmentVariable[];
    }> {
        logger.info(
            `[EnvVarVersioning] Comparing environment variables between revisions ${revision1} and ${revision2}`
        );

        const [envVars1, envVars2] = await Promise.all([
            this.getEnvironmentVariablesFromVersion(clusterName, serviceName, containerName, revision1),
            this.getEnvironmentVariablesFromVersion(clusterName, serviceName, containerName, revision2),
        ]);

        const envVars1Map = new Map(envVars1.map(env => [env.name, env]));
        const envVars2Map = new Map(envVars2.map(env => [env.name, env]));

        const added: EnvironmentVariable[] = [];
        const removed: EnvironmentVariable[] = [];
        const modified: VariableChange[] = [];
        const unchanged: EnvironmentVariable[] = [];

        // Check for added and modified variables
        for (const [name, envVar2] of envVars2Map) {
            if (!envVars1Map.has(name)) {
                added.push(envVar2);
            } else {
                const envVar1 = envVars1Map.get(name)!;
                if (envVar1.value !== envVar2.value) {
                    modified.push({
                        name,
                        oldValue: envVar1.value,
                        newValue: envVar2.value,
                        status: ComparisonStatus.MODIFIED,
                    });
                } else {
                    unchanged.push(envVar2);
                }
            }
        }

        // Check for removed variables
        for (const [name, envVar1] of envVars1Map) {
            if (!envVars2Map.has(name)) {
                removed.push(envVar1);
            }
        }

        return {added, removed, modified, unchanged};
    }

    /**
     * Bulk update environment variables across multiple containers with versioning
     */
    public async bulkUpdateWithVersioning(
        clusterName: string,
        serviceName: string,
        operations: BulkOperation[]
    ): Promise<string> {
        logger.info(
            `[EnvVarVersioning] Bulk updating environment variables for ${operations.length} containers in service: ${serviceName}`
        );

        // Process each operation sequentially to maintain consistency
        let lastTaskDefinitionArn = '';

        for (const operation of operations) {
            switch (operation.operation) {
                case BulkOperationType.ADD:
                    lastTaskDefinitionArn = (
                        await this.environmentVariableService.addEnvironmentVariables(
                            clusterName,
                            serviceName,
                            operation.containerName,
                            operation.environmentVariables,
                            operation.secrets
                        )
                    ).taskDefinitionArn;
                    break;
                case BulkOperationType.EDIT:
                    lastTaskDefinitionArn = (
                        await this.environmentVariableService.editEnvironmentVariables(
                            clusterName,
                            serviceName,
                            operation.containerName,
                            operation.environmentVariables,
                            operation.secrets
                        )
                    ).taskDefinitionArn;
                    break;
                case BulkOperationType.REPLACE:
                    lastTaskDefinitionArn = await this.environmentVariableService.replaceAllEnvironmentVariables(
                        clusterName,
                        serviceName,
                        operation.containerName,
                        operation.environmentVariables
                    );
                    break;
                case BulkOperationType.REMOVE:
                    if (!operation.variableNames || operation.variableNames.length === 0) {
                        throw new Error('Variable names are required for remove operation');
                    }
                    lastTaskDefinitionArn = (
                        await this.environmentVariableService.removeEnvironmentVariables(
                            clusterName,
                            serviceName,
                            operation.containerName,
                            operation.variableNames,
                            operation.secretNames
                        )
                    ).taskDefinitionArn;
                    break;
                default:
                    throw new Error(`Unknown operation: ${operation.operation}`);
            }
        }

        return lastTaskDefinitionArn;
    }
}
