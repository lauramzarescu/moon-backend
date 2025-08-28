import {ECSClient} from '@aws-sdk/client-ecs';
import {TaskDefinitionService} from './task-definition.service';
import {EnvironmentVariableService} from './environment-variable.service';
import {EnvironmentVariable} from '../../interfaces/aws-entities/environment-variable.interface';
import logger from '../../config/logger';
import {
    BulkOperation,
    EnvironmentVariableVersion,
    VariableChange,
} from '../../types/aws/environment-variable-api.types';

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
     * Get all environment variable versions for a service container
     */
    public async getEnvironmentVariableVersions(
        clusterName: string,
        serviceName: string,
        containerName: string
    ): Promise<EnvironmentVariableVersion[]> {
        logger.info(
            `[EnvVarVersioning] Getting environment variable versions for service: ${serviceName}, container: ${containerName}`
        );

        const versions = await this.taskDefinitionService.getTaskDefinitionVersionsForService(clusterName, serviceName);

        return await Promise.all(
            versions.map(async version => {
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
     * Copy environment variables from one service to another
     */
    public async copyEnvironmentVariablesBetweenServices(
        sourceClusterName: string,
        sourceServiceName: string,
        sourceContainerName: string,
        targetClusterName: string,
        targetServiceName: string,
        targetContainerName: string,
        sourceRevision?: number
    ): Promise<string> {
        logger.info(
            `[EnvVarVersioning] Copying environment variables from ${sourceServiceName}:${sourceContainerName} to ${targetServiceName}:${targetContainerName}`
        );

        let sourceEnvVars: EnvironmentVariable[];

        if (sourceRevision) {
            sourceEnvVars = await this.getEnvironmentVariablesFromVersion(
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
        }

        if (sourceEnvVars.length === 0) {
            throw new Error('No environment variables found in source service');
        }

        return await this.environmentVariableService.replaceAllEnvironmentVariables(
            targetClusterName,
            targetServiceName,
            targetContainerName,
            sourceEnvVars
        );
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

        const envVars1Map = new Map(envVars1.map(env => [env.name, env.value]));
        const envVars2Map = new Map(envVars2.map(env => [env.name, env.value]));

        const added: EnvironmentVariable[] = [];
        const removed: EnvironmentVariable[] = [];
        const modified: Array<{name: string; oldValue: string; newValue: string}> = [];
        const unchanged: EnvironmentVariable[] = [];

        // Check for added and modified variables
        for (const [name, value] of envVars2Map) {
            if (!envVars1Map.has(name)) {
                added.push({name, value});
            } else if (envVars1Map.get(name) !== value) {
                modified.push({
                    name,
                    oldValue: envVars1Map.get(name)!,
                    newValue: value,
                });
            } else {
                unchanged.push({name, value});
            }
        }

        // Check for removed variables
        for (const [name, value] of envVars1Map) {
            if (!envVars2Map.has(name)) {
                removed.push({name, value});
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
                case 'add':
                    lastTaskDefinitionArn = await this.environmentVariableService.addEnvironmentVariables(
                        clusterName,
                        serviceName,
                        operation.containerName,
                        operation.environmentVariables
                    );
                    break;
                case 'edit':
                    lastTaskDefinitionArn = await this.environmentVariableService.editEnvironmentVariables(
                        clusterName,
                        serviceName,
                        operation.containerName,
                        operation.environmentVariables
                    );
                    break;
                case 'replace':
                    lastTaskDefinitionArn = await this.environmentVariableService.replaceAllEnvironmentVariables(
                        clusterName,
                        serviceName,
                        operation.containerName,
                        operation.environmentVariables
                    );
                    break;
                case 'remove':
                    if (!operation.variableNames || operation.variableNames.length === 0) {
                        throw new Error('Variable names are required for remove operation');
                    }
                    lastTaskDefinitionArn = await this.environmentVariableService.removeEnvironmentVariables(
                        clusterName,
                        serviceName,
                        operation.containerName,
                        operation.variableNames
                    );
                    break;
                default:
                    throw new Error(`Unknown operation: ${operation.operation}`);
            }
        }

        return lastTaskDefinitionArn;
    }
}
