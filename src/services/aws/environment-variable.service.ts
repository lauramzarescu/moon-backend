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
     * Supports renaming keys via optional `originalName` on each item.
     * - If `originalName` is provided and differs from `name`, the key will be renamed.
     * - If `originalName` is omitted, `name` is treated as the key to update.
     * - For secrets, the same logic applies using optional `originalName`.
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

        // ----- Environment variables (support rename) -----
        const currentEnvMap = new Map(currentEnvVars.map(e => [e.name, e.value]));

        type EnvUpdate = {originalName: string; newName: string; newValue: string};
        const envUpdates: EnvUpdate[] = updatedEnvironmentVariables.map((env: any) => ({
            originalName: env && typeof env === 'object' && env.originalName ? String(env.originalName) : env.name,
            newName: env.name,
            newValue: env.value,
        }));

        // Validate existence of originals
        const missingEnv = envUpdates.filter(u => !currentEnvMap.has(u.originalName)).map(u => u.originalName);
        if (missingEnv.length > 0) {
            throw new Error(`Environment variables do not exist: ${Array.from(new Set(missingEnv)).join(', ')}`);
        }

        // Validate duplicate targets and conflicts
        const targetEnvNames = new Set<string>();
        const originalsEnvSet = new Set(envUpdates.map(u => u.originalName));
        for (const u of envUpdates) {
            if (targetEnvNames.has(u.newName)) {
                throw new Error(`Duplicate target variable name in request: ${u.newName}`);
            }
            targetEnvNames.add(u.newName);

            if (u.newName !== u.originalName) {
                const targetExistsInCurrent = currentEnvMap.has(u.newName);
                const targetBeingRenamedAway = originalsEnvSet.has(u.newName);
                if (targetExistsInCurrent && !targetBeingRenamedAway) {
                    throw new Error(`Cannot rename to existing variable '${u.newName}' that is not being renamed away`);
                }
            }
        }

        // Apply updates (rename/value changes)
        for (const u of envUpdates) {
            const oldVal = currentEnvMap.get(u.originalName)!;
            currentEnvMap.delete(u.originalName);
            currentEnvMap.set(u.newName, u.newValue ?? oldVal);
        }

        const finalEnvVars = Array.from(currentEnvMap.entries()).map(([name, value]) => ({name, value}));

        // ----- Secrets (support rename) -----
        const currentSecretMap = new Map(currentSecrets.map(s => [s.name, s.valueFrom]));

        type SecretUpdate = {originalName: string; newName: string; newValueFrom: string};
        const secretUpdates: SecretUpdate[] = updatedSecrets.map((s: any) => ({
            originalName: s && typeof s === 'object' && s.originalName ? String(s.originalName) : s.name,
            newName: s.name,
            newValueFrom: s.valueFrom,
        }));

        const missingSecrets = secretUpdates
            .filter(u => !currentSecretMap.has(u.originalName))
            .map(u => u.originalName);
        if (missingSecrets.length > 0) {
            throw new Error(`Secrets do not exist: ${Array.from(new Set(missingSecrets)).join(', ')}`);
        }

        const targetSecretNames = new Set<string>();
        const originalsSecretSet = new Set(secretUpdates.map(u => u.originalName));
        for (const u of secretUpdates) {
            if (targetSecretNames.has(u.newName)) {
                throw new Error(`Duplicate target secret name in request: ${u.newName}`);
            }
            targetSecretNames.add(u.newName);

            if (u.newName !== u.originalName) {
                const targetExistsInCurrent = currentSecretMap.has(u.newName);
                const targetBeingRenamedAway = originalsSecretSet.has(u.newName);
                if (targetExistsInCurrent && !targetBeingRenamedAway) {
                    throw new Error(`Cannot rename to existing secret '${u.newName}' that is not being renamed away`);
                }
            }
        }

        for (const u of secretUpdates) {
            const oldValFrom = currentSecretMap.get(u.originalName)!;
            currentSecretMap.delete(u.originalName);
            currentSecretMap.set(u.newName, u.newValueFrom ?? oldValFrom);
        }

        const finalSecrets = Array.from(currentSecretMap.entries()).map(([name, valueFrom]) => ({name, valueFrom}));

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
