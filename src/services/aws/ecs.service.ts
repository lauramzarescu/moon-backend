import {
    DescribeClustersCommand,
    DescribeServicesCommand,
    DescribeTaskDefinitionCommand,
    DescribeTaskDefinitionCommandOutput,
    DescribeTasksCommand,
    ECSClient,
    ListClustersCommand,
    ListServicesCommand,
    ListTasksCommand,
    RegisterTaskDefinitionCommand,
    UpdateServiceCommand,
} from '@aws-sdk/client-ecs';
import {backoffAndRetry} from '../../utils/backoff.util';
import {ClusterInterface} from '../../interfaces/aws-entities/cluster.interface';
import {ServiceInterface} from '../../interfaces/aws-entities/service.interface';
import {SchedulerService} from './scheduler.service';
import {DeploymentMonitorService} from './deployment-monitor.service';
import logger from '../../config/logger';
import {Cluster, Service} from '@aws-sdk/client-ecs/dist-types/models';
import {Deployment} from '@aws-sdk/client-ecs/dist-types/models/models_0';
import {ScheduledTaskInterface} from '../../interfaces/aws-entities/scheduled-task.interface';

export class ECSService {
    private readonly ecsClient: ECSClient;
    private readonly schedulerService: SchedulerService;
    private readonly deploymentMonitorService: DeploymentMonitorService;
    private taskDefinitionCache = new Map<string, DescribeTaskDefinitionCommandOutput>();

    constructor(ecsClient: ECSClient) {
        this.ecsClient = ecsClient;
        this.schedulerService = new SchedulerService();
        this.deploymentMonitorService = new DeploymentMonitorService(ecsClient);
    }

    /**
     * Retrieve basic cluster details without services and scheduled tasks.
     */
    public getBasicClusterDetails = async (): Promise<ClusterInterface[]> => {
        logger.info('[ECS] Fetching basic cluster details');
        const clusters = await backoffAndRetry(() => this.ecsClient.send(new ListClustersCommand({})));

        const clusterResponse = await backoffAndRetry(() =>
            this.ecsClient.send(
                new DescribeClustersCommand({
                    clusters: clusters.clusterArns,
                })
            )
        );

        if (!clusterResponse.clusters?.length) {
            return [];
        }

        // Return basic cluster info without services and scheduled tasks
        return clusterResponse.clusters.map(cluster => ({
            name: cluster.clusterName ?? 'N/A',
            arn: cluster.clusterArn ?? 'N/A',
            status:
                (cluster.status as 'ACTIVE' | 'INACTIVE' | 'FAILED' | 'PROVISIONING' | 'DEPROVISIONING') ?? 'INACTIVE',
            runningTasks: cluster.runningTasksCount ?? 0,
            pendingTasks: cluster.pendingTasksCount ?? 0,
            registeredContainerInstances: cluster.registeredContainerInstancesCount ?? 0,
            servicesCount: cluster.activeServicesCount ?? 0,
            services: [],
            scheduledTasks: [],
        }));
    };

    // Get services for a specific cluster
    public getClusterServicesOnly = async (clusterName: string): Promise<ServiceInterface[]> => {
        logger.info(`[ECS] Fetching services for cluster: ${clusterName}`);
        return await this.getClusterServices(clusterName, true);
    };

    // Get scheduled tasks for a specific cluster
    public getClusterScheduledTasksOnly = async (
        clusterArn: string,
        clusterName: string
    ): Promise<ScheduledTaskInterface[]> => {
        logger.info(`[ECS] Fetching scheduled tasks for cluster: ${clusterName}`);
        return await this.schedulerService.getECSScheduledTasks(clusterArn, clusterName);
    };

    public checkForStuckDeployment = async (clusterName: string, serviceName: string) => {
        return await this.deploymentMonitorService.isDeploymentStuck(clusterName, serviceName);
    };

    public getClusterServices = async (
        clusterName: string,
        checkStuckDeployments = true
    ): Promise<ServiceInterface[]> => {
        const servicesResponse = await backoffAndRetry(() =>
            this.ecsClient.send(new ListServicesCommand({cluster: clusterName, maxResults: 100}))
        );

        const serviceNames = servicesResponse.serviceArns?.map((arn: string) => arn.split('/').pop() ?? '') ?? [];
        if (serviceNames.length === 0) return [];

        // Process services in parallel batches
        const batchSize = 10;
        const serviceBatches = [];
        for (let i = 0; i < serviceNames.length; i += batchSize) {
            const batch = serviceNames.slice(i, i + batchSize);
            serviceBatches.push(batch);
        }

        // Process all batches in parallel
        const allServicePromises = serviceBatches.map(batch =>
            this.processBatch(batch, clusterName, checkStuckDeployments)
        );
        const batchResults = await Promise.all(allServicePromises);

        // Flatten results
        return batchResults.flat();
    };

    private async processBatch(
        serviceNames: string[],
        clusterName: string,
        checkStuckDeployments: boolean
    ): Promise<ServiceInterface[]> {
        const serviceDetails = await backoffAndRetry(() =>
            this.ecsClient.send(
                new DescribeServicesCommand({
                    cluster: clusterName,
                    services: serviceNames,
                })
            )
        );

        if (!serviceDetails.services?.length) return [];

        // Get unique task definitions to avoid duplicate calls
        const uniqueTaskDefinitions = new Set(
            serviceDetails.services.map(service => service.taskDefinition).filter(Boolean) as string[]
        );

        // Fetch all task definitions in parallel
        const taskDefPromises = Array.from(uniqueTaskDefinitions).map(async taskDefArn => {
            if (this.taskDefinitionCache.has(taskDefArn)) {
                return [taskDefArn, this.taskDefinitionCache.get(taskDefArn)!] as const;
            }

            const taskResponse = await backoffAndRetry(() =>
                this.ecsClient.send(new DescribeTaskDefinitionCommand({taskDefinition: taskDefArn}))
            );

            this.taskDefinitionCache.set(taskDefArn, taskResponse);
            return [taskDefArn, taskResponse] as const;
        });

        const taskDefinitions = new Map(await Promise.all(taskDefPromises));

        // Process all services in parallel
        const servicePromises = serviceDetails.services.map(service =>
            this.processService(service, clusterName, taskDefinitions, checkStuckDeployments)
        );

        return Promise.all(servicePromises);
    }

    private async processService(
        service: Service,
        clusterName: string,
        taskDefinitions: Map<string, DescribeTaskDefinitionCommandOutput>,
        checkStuckDeployments: boolean
    ): Promise<ServiceInterface> {
        const taskDefinitionArn = service?.taskDefinition;
        if (!taskDefinitionArn) {
            throw new Error('Task definition not found');
        }

        const taskResponse = taskDefinitions.get(taskDefinitionArn);
        if (!taskResponse) {
            throw new Error(`Task definition ${taskDefinitionArn} not found in cache`);
        }

        const serviceData = this.mapServiceDetails(service, taskResponse, clusterName);

        // Run failed tasks and stuck deployment checks in parallel
        const parallelTasks = [];

        // Get failed tasks
        parallelTasks.push(
            this.getFailedTasks(clusterName, service.serviceName || '').then(failedTasks => {
                if (failedTasks?.length) {
                    serviceData.failedTasks = failedTasks;
                }
            })
        );

        // Check for stuck deployments if needed
        if (checkStuckDeployments && service.deployments && service.deployments.length > 1) {
            parallelTasks.push(
                this.checkForStuckDeployment(clusterName, service.serviceName || '').then(deploymentStatus => {
                    if (deploymentStatus.isStuck) {
                        serviceData.deploymentStatus = {
                            isStuck: true,
                            stuckSince: deploymentStatus.details?.startTime,
                            elapsedTimeMs: deploymentStatus.details?.elapsedTimeMs,
                            currentImages: deploymentStatus.details?.currentImages || [],
                            targetImages: deploymentStatus.details?.targetImages || [],
                        };
                    }
                })
            );
        }

        await Promise.all(parallelTasks);
        return serviceData;
    }

    private async getFailedTasks(clusterName: string, serviceName: string) {
        try {
            const failedTasksListResponse = await backoffAndRetry(() =>
                this.ecsClient.send(
                    new ListTasksCommand({
                        cluster: clusterName,
                        serviceName: serviceName,
                        desiredStatus: 'STOPPED',
                    })
                )
            );

            if (!failedTasksListResponse.taskArns?.length) {
                return [];
            }

            const failedTasksResponse = await backoffAndRetry(() =>
                this.ecsClient.send(
                    new DescribeTasksCommand({
                        cluster: clusterName,
                        tasks: failedTasksListResponse.taskArns,
                    })
                )
            );

            return failedTasksResponse.tasks || [];
        } catch (error) {
            logger.warn(`Failed to get failed tasks for service ${serviceName}:`, error);
            return [];
        }
    }

    public getClusterDetails = async (instances: any[]): Promise<ClusterInterface[]> => {
        const clusters = await backoffAndRetry(() => this.ecsClient.send(new ListClustersCommand({})));

        const clusterResponse = await backoffAndRetry(() =>
            this.ecsClient.send(
                new DescribeClustersCommand({
                    clusters: clusters.clusterArns,
                })
            )
        );

        if (!clusterResponse.clusters?.length) {
            return [];
        }

        // Process all clusters in parallel
        const clusterPromises = clusterResponse.clusters.map(async cluster => {
            if (!cluster.clusterName || !cluster.clusterArn) {
                logger.info('Cluster does not exist');
                return null;
            }

            // Run all cluster operations in parallel
            const [scheduledTasks, services] = await Promise.all([
                this.schedulerService.getECSScheduledTasks(cluster.clusterArn, cluster.clusterName),
                this.getClusterServices(cluster.clusterName),
            ]);

            return this.mapClusterDetails(cluster, services, scheduledTasks);
        });

        const results = await Promise.all(clusterPromises);
        return results.filter(Boolean) as ClusterInterface[];
    };

    public updateServiceDesiredCount = async (
        clusterName: string,
        serviceName: string,
        desiredCount: number
    ): Promise<void> => {
        await backoffAndRetry(() =>
            this.ecsClient.send(
                new UpdateServiceCommand({
                    cluster: clusterName,
                    service: serviceName,
                    desiredCount: desiredCount,
                })
            )
        );
    };

    /**
     * Updates a service's container image by creating a new task definition revision
     * and updating the service to use it
     *
     * @param clusterName - The name of the ECS cluster
     * @param serviceName - The name of the service to update
     * @param containerName - The name of the container to update
     * @param newImageUri - The new Docker image URI (e.g., "nginx:latest")
     * @returns The ARN of the new task definition
     */
    public updateServiceContainerImage = async (
        clusterName: string,
        serviceName: string,
        containerName: string,
        newImageUri: string
    ): Promise<string> => {
        // 1. Get the current service details to find the task definition
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
        const currentTaskDefinitionArn = service.taskDefinition;
        if (!currentTaskDefinitionArn) {
            throw new Error('Task definition not found for service');
        }

        // 2. Get the current task definition
        const taskDefResponse = await backoffAndRetry(() =>
            this.ecsClient.send(
                new DescribeTaskDefinitionCommand({
                    taskDefinition: currentTaskDefinitionArn,
                })
            )
        );

        const taskDef = taskDefResponse.taskDefinition;
        if (!taskDef) {
            throw new Error(`Task definition ${currentTaskDefinitionArn} not found`);
        }

        // 3. Create a new task definition with the updated image
        const containerDefs = [...(taskDef.containerDefinitions || [])];

        // Find the container to update
        const containerIndex = containerDefs.findIndex(container => container.name === containerName);
        if (containerIndex === -1) {
            throw new Error(`Container ${containerName} not found in task definition`);
        }

        // Update the container image
        containerDefs[containerIndex] = {
            ...containerDefs[containerIndex],
            image: newImageUri,
        };

        // 4. Register the new task definition
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

        // Remove undefined properties to avoid API errors
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

        // 5. Update the service to use the new task definition
        await backoffAndRetry(() =>
            this.ecsClient.send(
                new UpdateServiceCommand({
                    cluster: clusterName,
                    service: serviceName,
                    taskDefinition: newTaskDefArn,
                })
            )
        );

        return newTaskDefArn;
    };

    public restartService = async (clusterName: string, serviceName: string): Promise<void> => {
        await backoffAndRetry(() =>
            this.ecsClient.send(
                new UpdateServiceCommand({
                    cluster: clusterName,
                    service: serviceName,
                    forceNewDeployment: true,
                })
            )
        );
    };

    private mapServiceDetails = (
        service: Service,
        taskResponse: DescribeTaskDefinitionCommandOutput,
        clusterName: string
    ): ServiceInterface => {
        return {
            name: service.serviceName ?? 'N/A',
            clusterName: clusterName,
            desiredCount: service.desiredCount ?? 0,
            runningCount: service.runningCount ?? 0,
            pendingCount: service.pendingCount ?? 0,
            status: (service.status as 'ACTIVE' | 'INACTIVE' | 'DRAINING') ?? 'INACTIVE',
            taskDefinition: {
                family: taskResponse.taskDefinition?.family ?? 'N/A',
                revision: taskResponse.taskDefinition?.revision ?? -1,
                arn: taskResponse.taskDefinition?.taskDefinitionArn ?? '',
                name: service.taskDefinition ?? '',
                registeredAt: taskResponse.taskDefinition?.registeredAt?.toISOString() ?? 'N/A',
                status: taskResponse.taskDefinition?.status ?? 'INACTIVE',
                cpu: taskResponse.taskDefinition?.cpu ?? 'N/A',
                memory: taskResponse.taskDefinition?.memory ?? 'N/A',
            },
            containers: this.mapContainerDefinitions(taskResponse),
            deployments: this.mapDeployments(service.deployments ?? []),
            deploymentStatus: undefined,
        };
    };

    private mapContainerDefinitions = (taskResponse: DescribeTaskDefinitionCommandOutput) => {
        return (
            taskResponse.taskDefinition?.containerDefinitions?.map((container: any) => ({
                name: container.name ?? '',
                image: container.image ?? '',
                cpu: container.cpu ?? 0,
                memory: container.memory ?? 0,
                environmentVariables: {
                    environment:
                        container.environment?.map((env: {name: string; value: string}) => ({
                            name: env.name ?? '',
                            value: env.value ?? '',
                        })) ?? [],
                    environmentFiles: container.environmentFiles ?? [],
                    secrets:
                        container.secrets?.map((env: {name: string; valueFrom: string}) => ({
                            name: env.name ?? '',
                            value: env.valueFrom ?? '',
                        })) ?? [],
                },
            })) ?? []
        );
    };

    private mapDeployments = (deployments: Deployment[]) => {
        return (
            deployments?.map((deployment: any) => ({
                status: deployment.status ?? '',
                desiredCount: deployment.desiredCount ?? 0,
                pendingCount: deployment.pendingCount ?? 0,
                runningCount: deployment.runningCount ?? 0,
                createdAt: deployment.createdAt ?? new Date(),
                updatedAt: deployment.updatedAt ?? new Date(),
                failedTasks: deployment.failedTasks ?? 0,
                rolloutState: deployment.rolloutState ?? '',
                rolloutStateReason: deployment.rolloutStateReason ?? '',
            })) ?? []
        );
    };

    private mapClusterDetails = (
        cluster: Cluster,
        services: ServiceInterface[],
        scheduledTasks: ScheduledTaskInterface[]
    ): ClusterInterface => {
        return {
            name: cluster.clusterName ?? 'N/A',
            arn: cluster.clusterArn ?? 'N/A',
            status:
                (cluster.status as 'ACTIVE' | 'INACTIVE' | 'FAILED' | 'PROVISIONING' | 'DEPROVISIONING') ?? 'INACTIVE',
            runningTasks: cluster.runningTasksCount ?? 0,
            pendingTasks: cluster.pendingTasksCount ?? 0,
            registeredContainerInstances: cluster.registeredContainerInstancesCount ?? 0,
            servicesCount: cluster.activeServicesCount ?? 0,
            services,
            scheduledTasks,
        };
    };
}
