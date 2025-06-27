import {
    DescribeTaskDefinitionCommand,
    DescribeTaskDefinitionCommandOutput,
    ECSClient,
    RegisterTaskDefinitionCommand,
} from '@aws-sdk/client-ecs';
import {backoffAndRetry} from '../../utils/backoff.util';

export class TaskDefinitionService {
    private readonly ecsClient: ECSClient;
    private taskDefinitionCache = new Map<string, DescribeTaskDefinitionCommandOutput>();

    constructor(ecsClient: ECSClient) {
        this.ecsClient = ecsClient;
    }

    public async getTaskDefinition(taskDefinitionArn: string): Promise<DescribeTaskDefinitionCommandOutput> {
        if (this.taskDefinitionCache.has(taskDefinitionArn)) {
            return this.taskDefinitionCache.get(taskDefinitionArn)!;
        }

        const taskResponse = await backoffAndRetry(() =>
            this.ecsClient.send(new DescribeTaskDefinitionCommand({taskDefinition: taskDefinitionArn}))
        );

        this.taskDefinitionCache.set(taskDefinitionArn, taskResponse);
        return taskResponse;
    }

    public async getMultipleTaskDefinitions(
        taskDefinitionArns: string[]
    ): Promise<Map<string, DescribeTaskDefinitionCommandOutput>> {
        const uniqueTaskDefinitions = new Set(taskDefinitionArns);

        const taskDefPromises = Array.from(uniqueTaskDefinitions).map(async taskDefArn => {
            const taskResponse = await this.getTaskDefinition(taskDefArn);
            return [taskDefArn, taskResponse] as const;
        });

        return new Map(await Promise.all(taskDefPromises));
    }

    public async registerNewTaskDefinitionWithUpdatedImage(
        currentTaskDefinitionArn: string,
        containerName: string,
        newImageUri: string
    ): Promise<string> {
        const taskDefResponse = await this.getTaskDefinition(currentTaskDefinitionArn);
        const taskDef = taskDefResponse.taskDefinition;

        if (!taskDef) {
            throw new Error(`Task definition ${currentTaskDefinitionArn} not found`);
        }

        const containerDefs = [...(taskDef.containerDefinitions || [])];
        const containerIndex = containerDefs.findIndex(container => container.name === containerName);

        if (containerIndex === -1) {
            throw new Error(`Container ${containerName} not found in task definition`);
        }

        containerDefs[containerIndex] = {
            ...containerDefs[containerIndex],
            image: newImageUri,
        };

        const registerParams: any = {
            family: taskDef.family,
            taskRoleArn: taskDef.taskRoleArn,
            executionRoleArn: taskDef.executionRoleArn,
            networkMode: taskDef.networkMode,
            containerDefinitions: containerDefs,
            volumes: taskDef.volumes,
            placementConstraints: taskDef.placementConstraints,
            requiresCompatibilities: taskDef.requiresCompatibilities,
            cpu: taskDef.cpu,
            memory: taskDef.memory,
            pidMode: taskDef.pidMode,
            ipcMode: taskDef.ipcMode,
            proxyConfiguration: taskDef.proxyConfiguration,
            inferenceAccelerators: taskDef.inferenceAccelerators,
            ephemeralStorage: taskDef.ephemeralStorage,
            runtimePlatform: taskDef.runtimePlatform,
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

        return newTaskDefArn;
    }
}
