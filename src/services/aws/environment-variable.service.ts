import {
    DescribeServicesCommand,
    ECSClient,
    RegisterTaskDefinitionCommand,
    UpdateServiceCommand,
} from '@aws-sdk/client-ecs';
import {backoffAndRetry} from '../../utils/backoff.util';
import {TaskDefinitionService} from './task-definition.service';
import {
    EnvironmentVariable,
    EnvironmentVariableOperation,
} from '../../interfaces/aws-entities/environment-variable.interface';
import logger from '../../config/logger';
import {ContainerDefinition, TaskDefinition} from '@aws-sdk/client-ecs/dist-types/models';

export class EnvironmentVariableService {
    private readonly ecsClient: ECSClient;
    private readonly taskDefinitionService: TaskDefinitionService;

    constructor(ecsClient: ECSClient) {
        this.ecsClient = ecsClient;
        this.taskDefinitionService = new TaskDefinitionService(ecsClient);
    }

    /**
     * Get environment variables for a specific container in a service
     */
    public async getServiceEnvironmentVariables(
        clusterName: string,
        serviceName: string,
        containerName: string
    ): Promise<EnvironmentVariable[]> {
        logger.info(`[EnvVar] Getting environment variables for service: ${serviceName}, container: ${containerName}`);

        const taskDefinitionArn = await this.getServiceTaskDefinitionArn(clusterName, serviceName);
        const taskDefResponse = await this.taskDefinitionService.getTaskDefinition(taskDefinitionArn);

        const containerDef = taskDefResponse.taskDefinition?.containerDefinitions?.find(
            container => container.name === containerName
        );

        if (!containerDef) {
            throw new Error(`Container ${containerName} not found in service ${serviceName}`);
        }

        return (
            containerDef.environment?.map(env => ({
                name: env.name || '',
                value: env.value || '',
            })) || []
        );
    }

    /**
     * Add environment variables to a service container
     */
    public async addEnvironmentVariables(
        clusterName: string,
        serviceName: string,
        containerName: string,
        newEnvironmentVariables: EnvironmentVariable[]
    ): Promise<string> {
        logger.info(
            `[EnvVar] Adding ${newEnvironmentVariables.length} environment variables to service: ${serviceName}, container: ${containerName}`
        );

        const currentEnvVars = await this.getServiceEnvironmentVariables(clusterName, serviceName, containerName);

        // Check for duplicate variable names
        const existingNames = new Set(currentEnvVars.map(env => env.name));
        const duplicates = newEnvironmentVariables.filter(env => existingNames.has(env.name));

        if (duplicates.length > 0) {
            throw new Error(`Environment variables already exist: ${duplicates.map(d => d.name).join(', ')}`);
        }

        const updatedEnvVars = [...currentEnvVars, ...newEnvironmentVariables];
        return await this.updateServiceEnvironmentVariables(clusterName, serviceName, containerName, updatedEnvVars);
    }

    /**
     * Edit existing environment variables in a service container
     */
    public async editEnvironmentVariables(
        clusterName: string,
        serviceName: string,
        containerName: string,
        updatedEnvironmentVariables: EnvironmentVariable[]
    ): Promise<string> {
        logger.info(
            `[EnvVar] Editing ${updatedEnvironmentVariables.length} environment variables for service: ${serviceName}, container: ${containerName}`
        );

        const currentEnvVars = await this.getServiceEnvironmentVariables(clusterName, serviceName, containerName);

        // Create a map for quick lookup
        const updatedEnvMap = new Map(updatedEnvironmentVariables.map(env => [env.name, env.value]));

        // Check if all variables to edit exist
        const currentNames = new Set(currentEnvVars.map(env => env.name));
        const missingVars = updatedEnvironmentVariables.filter(env => !currentNames.has(env.name));

        if (missingVars.length > 0) {
            throw new Error(`Environment variables do not exist: ${missingVars.map(v => v.name).join(', ')}`);
        }

        // Update existing variables
        const finalEnvVars = currentEnvVars.map(env => ({
            name: env.name,
            value: updatedEnvMap.has(env.name) ? updatedEnvMap.get(env.name)! : env.value,
        }));

        return await this.updateServiceEnvironmentVariables(clusterName, serviceName, containerName, finalEnvVars);
    }

    /**
     * Remove environment variables from a service container
     */
    public async removeEnvironmentVariables(
        clusterName: string,
        serviceName: string,
        containerName: string,
        variableNames: string[]
    ): Promise<string> {
        logger.info(
            `[EnvVar] Removing environment variables: ${variableNames.join(', ')} from service: ${serviceName}, container: ${containerName}`
        );

        const currentEnvVars = await this.getServiceEnvironmentVariables(clusterName, serviceName, containerName);

        // Check if all variables to remove exist
        const currentNames = new Set(currentEnvVars.map(env => env.name));
        const missingVars = variableNames.filter(name => !currentNames.has(name));

        if (missingVars.length > 0) {
            throw new Error(`Environment variables do not exist: ${missingVars.join(', ')}`);
        }

        // Filter out the variables to remove
        const namesToRemove = new Set(variableNames);
        const filteredEnvVars = currentEnvVars.filter(env => !namesToRemove.has(env.name));

        return await this.updateServiceEnvironmentVariables(clusterName, serviceName, containerName, filteredEnvVars);
    }

    /**
     * Replace all environment variables for a service container
     */
    public async replaceAllEnvironmentVariables(
        clusterName: string,
        serviceName: string,
        containerName: string,
        environmentVariables: EnvironmentVariable[]
    ): Promise<string> {
        logger.info(
            `[EnvVar] Replacing all environment variables for service: ${serviceName}, container: ${containerName}`
        );

        return await this.updateServiceEnvironmentVariables(
            clusterName,
            serviceName,
            containerName,
            environmentVariables
        );
    }

    /**
     * Bulk update environment variables for multiple containers in a service
     */
    public async bulkUpdateEnvironmentVariables(
        clusterName: string,
        serviceName: string,
        operations: EnvironmentVariableOperation[]
    ): Promise<string> {
        logger.info(
            `[EnvVar] Bulk updating environment variables for ${operations.length} containers in service: ${serviceName}`
        );

        const taskDefinitionArn = await this.getServiceTaskDefinitionArn(clusterName, serviceName);
        const taskDefResponse = await this.taskDefinitionService.getTaskDefinition(taskDefinitionArn);

        if (!taskDefResponse.taskDefinition) {
            throw new Error(`Task definition ${taskDefinitionArn} not found`);
        }

        const containerDefs = [...(taskDefResponse.taskDefinition.containerDefinitions || [])] as ContainerDefinition[];

        // Update each container's environment variables
        for (const operation of operations) {
            const containerIndex = containerDefs.findIndex(container => container.name === operation.containerName);

            if (containerIndex === -1) {
                throw new Error(`Container ${operation.containerName} not found in task definition`);
            }

            containerDefs[containerIndex] = {
                ...containerDefs[containerIndex],
                environment: operation.environmentVariables.map(env => ({
                    name: env.name,
                    value: env.value,
                })),
            };
        }

        return await this.registerNewTaskDefinitionWithUpdatedContainers(
            taskDefResponse.taskDefinition,
            containerDefs,
            clusterName,
            serviceName
        );
    }

    /**
     * Private method to update environment variables for a single container
     */
    private async updateServiceEnvironmentVariables(
        clusterName: string,
        serviceName: string,
        containerName: string,
        environmentVariables: EnvironmentVariable[]
    ): Promise<string> {
        const taskDefinitionArn = await this.getServiceTaskDefinitionArn(clusterName, serviceName);
        const taskDefResponse = await this.taskDefinitionService.getTaskDefinition(taskDefinitionArn);

        if (!taskDefResponse.taskDefinition) {
            throw new Error(`Task definition ${taskDefinitionArn} not found`);
        }

        const containerDefs = [...(taskDefResponse.taskDefinition.containerDefinitions || [])] as ContainerDefinition[];
        const containerIndex = containerDefs.findIndex(container => container.name === containerName);

        if (containerIndex === -1) {
            throw new Error(`Container ${containerName} not found in task definition`);
        }

        // Update only the environment variables, preserve secrets and other properties
        containerDefs[containerIndex] = {
            ...containerDefs[containerIndex],
            environment: environmentVariables.map(env => ({
                name: env.name,
                value: env.value,
            })),
        };

        return await this.registerNewTaskDefinitionWithUpdatedContainers(
            taskDefResponse.taskDefinition,
            containerDefs,
            clusterName,
            serviceName
        );
    }

    /**
     * Private method to get the task definition ARN for a service
     */
    private async getServiceTaskDefinitionArn(clusterName: string, serviceName: string): Promise<string> {
        const serviceDetails = await backoffAndRetry(() =>
            this.ecsClient.send(
                new DescribeServicesCommand({
                    cluster: clusterName,
                    services: [serviceName],
                })
            )
        );

        const service = serviceDetails.services?.[0];
        if (!service) {
            throw new Error(`Service ${serviceName} not found in cluster ${clusterName}`);
        }

        const taskDefinitionArn = service.taskDefinition;
        if (!taskDefinitionArn) {
            throw new Error('Task definition not found for service');
        }

        return taskDefinitionArn;
    }

    /**
     * Private method to register a new task definition and update the service
     */
    private async registerNewTaskDefinitionWithUpdatedContainers(
        currentTaskDef: TaskDefinition,
        updatedContainerDefs: ContainerDefinition[],
        clusterName: string,
        serviceName: string
    ): Promise<string> {
        const registerParams: any = {
            family: currentTaskDef.family,
            taskRoleArn: currentTaskDef.taskRoleArn,
            executionRoleArn: currentTaskDef.executionRoleArn,
            networkMode: currentTaskDef.networkMode,
            containerDefinitions: updatedContainerDefs,
            volumes: currentTaskDef.volumes,
            placementConstraints: currentTaskDef.placementConstraints,
            requiresCompatibilities: currentTaskDef.requiresCompatibilities,
            cpu: currentTaskDef.cpu,
            memory: currentTaskDef.memory,
            pidMode: currentTaskDef.pidMode,
            ipcMode: currentTaskDef.ipcMode,
            proxyConfiguration: currentTaskDef.proxyConfiguration,
            inferenceAccelerators: currentTaskDef.inferenceAccelerators,
            ephemeralStorage: currentTaskDef.ephemeralStorage,
            runtimePlatform: currentTaskDef.runtimePlatform,
        };

        // Remove undefined properties
        Object.keys(registerParams).forEach(key => {
            if (registerParams[key] === undefined) {
                delete registerParams[key];
            }
        });

        const newTaskDefResponse = await backoffAndRetry(() =>
            this.ecsClient.send(new RegisterTaskDefinitionCommand(registerParams))
        );

        const newTaskDefArn = newTaskDefResponse.taskDefinition?.taskDefinitionArn;
        if (!newTaskDefArn) {
            throw new Error('Failed to register new task definition');
        }

        // Update the service to use the new task definition
        await backoffAndRetry(() =>
            this.ecsClient.send(
                new UpdateServiceCommand({
                    cluster: clusterName,
                    service: serviceName,
                    taskDefinition: newTaskDefArn,
                })
            )
        );

        logger.info(`[EnvVar] Successfully updated service ${serviceName} with new task definition: ${newTaskDefArn}`);
        return newTaskDefArn;
    }
}
