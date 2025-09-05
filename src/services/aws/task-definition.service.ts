import {
    DescribeServicesCommand,
    DescribeTaskDefinitionCommand,
    DescribeTaskDefinitionCommandOutput,
    ECSClient,
    ListTaskDefinitionsCommand,
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

    /**
     * List all task definition revisions for a given family
     */
    public async listTaskDefinitionRevisions(family: string): Promise<string[]> {
        let hasMore = true; // Flag to check if there are more results using the nextToken field

        const response = await backoffAndRetry(() =>
            this.ecsClient.send(
                new ListTaskDefinitionsCommand({
                    familyPrefix: family,
                    status: 'ACTIVE',
                    sort: 'DESC',
                })
            )
        );
        hasMore = response.nextToken !== undefined;

        while (hasMore) {
            const nextResponse = await backoffAndRetry(() =>
                this.ecsClient.send(
                    new ListTaskDefinitionsCommand({
                        familyPrefix: family,
                        status: 'ACTIVE',
                        sort: 'DESC',
                        nextToken: response.nextToken,
                    })
                )
            );
            hasMore = nextResponse.nextToken !== undefined;
            response.taskDefinitionArns = [
                ...(response.taskDefinitionArns || []),
                ...(nextResponse.taskDefinitionArns || []),
            ];
        }

        return response.taskDefinitionArns || [];
    }

    /**
     * Get task definition family name from ARN or service name
     */
    public extractFamilyFromArn(taskDefinitionArn: string): string {
        // ARN format: arn:aws:ecs:region:account:task-definition/family:revision
        const parts = taskDefinitionArn.split('/');
        if (parts.length >= 2) {
            const familyRevision = parts[parts.length - 1];
            return familyRevision.split(':')[0];
        }
        throw new Error(`Invalid task definition ARN format: ${taskDefinitionArn}`);
    }

    /**
     * Get task definition revisions with metadata for a service
     */
    public async getTaskDefinitionVersionsForService(
        clusterName: string,
        serviceName: string
    ): Promise<
        Array<{
            revision: number;
            arn: string;
            registeredAt: string;
            status: string;
            family: string;
        }>
    > {
        const serviceResponse = await backoffAndRetry(() =>
            this.ecsClient.send(
                new DescribeServicesCommand({
                    cluster: clusterName,
                    services: [serviceName],
                })
            )
        );

        const service = serviceResponse.services?.[0];
        if (!service?.taskDefinition) {
            throw new Error(`Service ${serviceName} not found in cluster ${clusterName}`);
        }

        const family = this.extractFamilyFromArn(service.taskDefinition);
        const revisionArns = await this.listTaskDefinitionRevisions(family);

        // Get detailed information for each revision
        const revisionDetails = await Promise.all(
            revisionArns.map(async arn => {
                const taskDef = await this.getTaskDefinition(arn);
                return {
                    revision: taskDef.taskDefinition?.revision || 0,
                    arn: arn,
                    registeredAt: taskDef.taskDefinition?.registeredAt?.toISOString() || '',
                    status: taskDef.taskDefinition?.status || 'UNKNOWN',
                    family: taskDef.taskDefinition?.family || family,
                };
            })
        );

        return revisionDetails.sort((a, b) => b.revision - a.revision);
    }
}
