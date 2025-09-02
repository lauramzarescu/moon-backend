import {
    DescribeServicesCommand,
    ECSClient,
    RegisterTaskDefinitionCommand,
    UpdateServiceCommand,
} from '@aws-sdk/client-ecs';
import {backoffAndRetry} from '../../utils/backoff.util';
import {TaskDefinitionService} from './task-definition.service';
import {EnvironmentVariable, Secret} from '../../interfaces/aws-entities/environment-variable.interface';
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
     * Get secrets for a specific container in a service
     */
    public async getServiceSecrets(clusterName: string, serviceName: string, containerName: string): Promise<Secret[]> {
        logger.info(`[EnvVar] Getting secrets for service: ${serviceName}, container: ${containerName}`);

        const taskDefinitionArn = await this.getServiceTaskDefinitionArn(clusterName, serviceName);
        const taskDefResponse = await this.taskDefinitionService.getTaskDefinition(taskDefinitionArn);

        const containerDef = taskDefResponse.taskDefinition?.containerDefinitions?.find(
            container => container.name === containerName
        );

        if (!containerDef) {
            throw new Error(`Container ${containerName} not found in service ${serviceName}`);
        }

        return (
            containerDef.secrets?.map(secret => ({
                name: secret.name || '',
                valueFrom: secret.valueFrom || '',
            })) || []
        );
    }

    /**
     * Add environment variables and/or secrets to a service container
     */
    public async addEnvironmentVariables(
        clusterName: string,
        serviceName: string,
        containerName: string,
        newEnvironmentVariables: EnvironmentVariable[] = [],
        newSecrets: Secret[] = []
    ): Promise<{
        taskDefinitionArn: string;
        addedVariables: number;
        addedSecrets: number;
    }> {
        logger.info(
            `[EnvVar] Adding ${newEnvironmentVariables.length} environment variables and ${newSecrets.length} secrets to service: ${serviceName}, container: ${containerName}`
        );

        const [currentEnvVars, currentSecrets] = await Promise.all([
            this.getServiceEnvironmentVariables(clusterName, serviceName, containerName),
            this.getServiceSecrets(clusterName, serviceName, containerName),
        ]);

        // Check for duplicate variable names
        const existingEnvNames = new Set(currentEnvVars.map(env => env.name));
        const duplicateEnvVars = newEnvironmentVariables.filter(env => existingEnvNames.has(env.name));
        const nonDuplicateEnvVars = newEnvironmentVariables.filter(env => !existingEnvNames.has(env.name));

        if (duplicateEnvVars.length > 0) {
            logger.warn(`Environment variables already exist: ${duplicateEnvVars.map(d => d.name).join(', ')}`);
        }

        // Check for duplicate secret names
        const existingSecretNames = new Set(currentSecrets.map(secret => secret.name));
        const duplicateSecrets = newSecrets.filter(secret => existingSecretNames.has(secret.name));
        const nonDuplicateSecrets = newSecrets.filter(secret => !existingSecretNames.has(secret.name));

        if (duplicateSecrets.length > 0) {
            logger.warn(`Secrets already exist: ${duplicateSecrets.map(d => d.name).join(', ')}`);
        }

        const updatedEnvVars = [...currentEnvVars, ...nonDuplicateEnvVars];
        const updatedSecrets = [...currentSecrets, ...nonDuplicateSecrets];

        const taskDefinitionArn = await this.updateServiceEnvironmentVariablesAndSecrets(
            clusterName,
            serviceName,
            containerName,
            updatedEnvVars,
            updatedSecrets
        );

        return {
            taskDefinitionArn,
            addedVariables: nonDuplicateEnvVars.length,
            addedSecrets: nonDuplicateSecrets.length,
        };
    }

    /**
     * Edit existing environment variables and/or secrets in a service container
     */
    public async editEnvironmentVariables(
        clusterName: string,
        serviceName: string,
        containerName: string,
        updatedEnvironmentVariables: EnvironmentVariable[] = [],
        updatedSecrets: Secret[] = []
    ): Promise<{
        taskDefinitionArn: string;
        updatedVariables: number;
        updatedSecrets: number;
    }> {
        logger.info(
            `[EnvVar] Editing ${updatedEnvironmentVariables.length} environment variables and ${updatedSecrets.length} secrets for service: ${serviceName}, container: ${containerName}`
        );

        const [currentEnvVars, currentSecrets] = await Promise.all([
            this.getServiceEnvironmentVariables(clusterName, serviceName, containerName),
            this.getServiceSecrets(clusterName, serviceName, containerName),
        ]);

        // Handle environment variables
        const updatedEnvMap = new Map(updatedEnvironmentVariables.map(env => [env.name, env.value]));
        const currentEnvNames = new Set(currentEnvVars.map(env => env.name));
        const missingEnvVars = updatedEnvironmentVariables.filter(env => !currentEnvNames.has(env.name));

        if (missingEnvVars.length > 0) {
            throw new Error(`Environment variables do not exist: ${missingEnvVars.map(v => v.name).join(', ')}`);
        }

        // Handle secrets
        const updatedSecretsMap = new Map(updatedSecrets.map(secret => [secret.name, secret.valueFrom]));
        const currentSecretNames = new Set(currentSecrets.map(secret => secret.name));
        const missingSecrets = updatedSecrets.filter(secret => !currentSecretNames.has(secret.name));

        if (missingSecrets.length > 0) {
            throw new Error(`Secrets do not exist: ${missingSecrets.map(s => s.name).join(', ')}`);
        }

        // Update existing variables
        const finalEnvVars = currentEnvVars.map(env => ({
            name: env.name,
            value: updatedEnvMap.has(env.name) ? updatedEnvMap.get(env.name)! : env.value,
        }));

        // Update existing secrets
        const finalSecrets = currentSecrets.map(secret => ({
            name: secret.name,
            valueFrom: updatedSecretsMap.has(secret.name) ? updatedSecretsMap.get(secret.name)! : secret.valueFrom,
        }));

        const taskDefinitionArn = await this.updateServiceEnvironmentVariablesAndSecrets(
            clusterName,
            serviceName,
            containerName,
            finalEnvVars,
            finalSecrets
        );

        return {
            taskDefinitionArn,
            updatedVariables: updatedEnvironmentVariables.length,
            updatedSecrets: updatedSecrets.length,
        };
    }

    /**
     * Remove environment variables and/or secrets from a service container
     */
    public async removeEnvironmentVariables(
        clusterName: string,
        serviceName: string,
        containerName: string,
        variableNames: string[] = [],
        secretNames: string[] = []
    ): Promise<{
        taskDefinitionArn: string;
        removedVariables: number;
        removedSecrets: number;
    }> {
        logger.info(
            `[EnvVar] Removing environment variables: ${variableNames.join(', ')} and secrets: ${secretNames.join(', ')} from service: ${serviceName}, container: ${containerName}`
        );

        const [currentEnvVars, currentSecrets] = await Promise.all([
            this.getServiceEnvironmentVariables(clusterName, serviceName, containerName),
            this.getServiceSecrets(clusterName, serviceName, containerName),
        ]);

        // Check if all variables to remove exist
        const currentEnvNames = new Set(currentEnvVars.map(env => env.name));
        const missingVars = variableNames.filter(name => !currentEnvNames.has(name));

        if (missingVars.length > 0) {
            throw new Error(`Environment variables do not exist: ${missingVars.join(', ')}`);
        }

        // Check if all secrets to remove exist
        const currentSecretNames = new Set(currentSecrets.map(secret => secret.name));
        const missingSecrets = secretNames.filter(name => !currentSecretNames.has(name));

        if (missingSecrets.length > 0) {
            throw new Error(`Secrets do not exist: ${missingSecrets.join(', ')}`);
        }

        // Filter out the variables and secrets to remove
        const envNamesToRemove = new Set(variableNames);
        const secretNamesToRemove = new Set(secretNames);
        const filteredEnvVars = currentEnvVars.filter(env => !envNamesToRemove.has(env.name));
        const filteredSecrets = currentSecrets.filter(secret => !secretNamesToRemove.has(secret.name));

        const taskDefinitionArn = await this.updateServiceEnvironmentVariablesAndSecrets(
            clusterName,
            serviceName,
            containerName,
            filteredEnvVars,
            filteredSecrets
        );

        return {
            taskDefinitionArn,
            removedVariables: variableNames.length,
            removedSecrets: secretNames.length,
        };
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
     * Replace environment variables and secrets for a service container
     */
    public async replaceEnvironmentVariablesAndSecrets(
        clusterName: string,
        serviceName: string,
        containerName: string,
        environmentVariables: EnvironmentVariable[],
        secrets: Secret[]
    ): Promise<string> {
        logger.info(
            `[EnvVar] Replacing environment variables and secrets for service: ${serviceName}, container: ${containerName}`
        );

        return await this.updateServiceEnvironmentVariablesAndSecrets(
            clusterName,
            serviceName,
            containerName,
            environmentVariables,
            secrets
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
     * Private method to update both environment variables and secrets for a single container
     */
    private async updateServiceEnvironmentVariablesAndSecrets(
        clusterName: string,
        serviceName: string,
        containerName: string,
        environmentVariables: EnvironmentVariable[],
        secrets: Secret[]
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

        // Update both environment variables and secrets
        containerDefs[containerIndex] = {
            ...containerDefs[containerIndex],
            environment: environmentVariables.map(env => ({
                name: env.name,
                value: env.value,
            })),
            secrets: secrets.map(secret => ({
                name: secret.name,
                valueFrom: secret.valueFrom,
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
     * Private method to update secrets for a single container
     */
    private async updateServiceSecrets(
        clusterName: string,
        serviceName: string,
        containerName: string,
        secrets: Secret[]
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

        // Update only the secrets, preserve environment variables and other properties
        containerDefs[containerIndex] = {
            ...containerDefs[containerIndex],
            secrets: secrets.map(secret => ({
                name: secret.name,
                valueFrom: secret.valueFrom,
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
