import {
    DescribeClustersCommand,
    DescribeServicesCommand,
    DescribeTaskDefinitionCommand,
    ECSClient,
    ListClustersCommand,
    ListServicesCommand,
    RegisterTaskDefinitionCommand,
    UpdateServiceCommand,
} from '@aws-sdk/client-ecs';
import {backoffAndRetry} from '../../utils/backoff.util';
import {ClusterInterface} from '../../interfaces/aws-entities/cluster.interface';
import {ServiceInterface} from '../../interfaces/aws-entities/service.interface';
import {SchedulerService} from './scheduler.service';
import {DeploymentMonitorService} from './deployment-monitor.service';

export class ECSService {
    private readonly ecsClient: ECSClient;
    private readonly schedulerService: SchedulerService;
    private readonly deploymentMonitorService: DeploymentMonitorService;

    constructor(ecsClient: ECSClient) {
        this.ecsClient = ecsClient;
        this.schedulerService = new SchedulerService();
        this.deploymentMonitorService = new DeploymentMonitorService(ecsClient);
    }

    public getEnvironmentVariables = async (taskDefinitionArn: string) => {
        const response = await backoffAndRetry(() =>
            this.ecsClient.send(
                new DescribeTaskDefinitionCommand({
                    taskDefinition: taskDefinitionArn,
                })
            )
        );

        const containerDefArray = response.taskDefinition?.containerDefinitions;
        if (!containerDefArray) {
            throw new Error('Container definition not found');
        }

        return containerDefArray.map(containerDef => ({
            container: containerDef.name || '',
            environment: containerDef.environment || [],
            environmentFiles: containerDef.environmentFiles || [],
            secrets: containerDef.secrets || [],
        }));
    };

    public checkForStuckDeployment = async (clusterName: string, serviceName: string) => {
        return await this.deploymentMonitorService.isDeploymentStuck(clusterName, serviceName);
    };

    public getServiceTasksInfo = async (clusterName: string, serviceName: string) => {
        return await this.deploymentMonitorService.getTasksInfo(clusterName, serviceName);
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

        const batchSize = 10;
        const serviceBatches = [];
        for (let i = 0; i < serviceNames.length; i += batchSize) {
            const batch = serviceNames.slice(i, i + batchSize);
            serviceBatches.push(batch);
        }

        const services: ServiceInterface[] = [];

        for (const batch of serviceBatches) {
            const serviceDetails = await backoffAndRetry(() =>
                this.ecsClient.send(
                    new DescribeServicesCommand({
                        cluster: clusterName,
                        services: batch,
                    })
                )
            );

            for (const service of serviceDetails.services ?? []) {
                const taskDefinitionArn = service?.taskDefinition;
                if (!taskDefinitionArn) {
                    throw new Error('Task definition not found');
                }

                const taskResponse = await backoffAndRetry(() =>
                    this.ecsClient.send(
                        new DescribeTaskDefinitionCommand({
                            taskDefinition: taskDefinitionArn,
                        })
                    )
                );

                const serviceData = this.mapServiceDetails(service, taskResponse, clusterName);

                if (checkStuckDeployments && service.deployments && service.deployments.length > 1) {
                    const deploymentStatus = await this.checkForStuckDeployment(clusterName, service.serviceName || '');
                    if (deploymentStatus.isStuck) {
                        // Add stuck deployment information to the service data
                        serviceData.deploymentStatus = {
                            isStuck: true,
                            stuckSince: deploymentStatus.details?.startTime,
                            elapsedTimeMs: deploymentStatus.details?.elapsedTimeMs,
                            currentImages: deploymentStatus.details?.currentImages || [],
                            targetImages: deploymentStatus.details?.targetImages || [],
                        };
                    }
                }

                services.push(serviceData);
            }
        }

        return services;
    };

    public monitorAndResolveStuckDeployment = async (
        clusterName: string,
        serviceName: string,
        autoResolve = false,
        timeoutMinutes = 30
    ) => {
        const deploymentStatus = await this.checkForStuckDeployment(clusterName, serviceName);

        if (deploymentStatus.isStuck) {
            console.log(`Detected stuck deployment for service ${serviceName} in cluster ${clusterName}`);

            if (autoResolve) {
                console.log(`Auto-resolving stuck deployment by forcing a new deployment`);
                await this.restartService(clusterName, serviceName);
                return {
                    wasStuck: true,
                    resolved: true,
                    action: 'forced-new-deployment',
                };
            }

            return {
                wasStuck: true,
                resolved: false,
                details: deploymentStatus.details,
            };
        }

        return {
            wasStuck: false,
        };
    };

    public getClusterDetails = async (instances: any[]): Promise<ClusterInterface[]> => {
        const clusters = await backoffAndRetry(() => this.ecsClient.send(new ListClustersCommand({})));

        const clusterResponse = await backoffAndRetry(() =>
            this.ecsClient.send(
                new DescribeClustersCommand({
                    clusters: clusters.clusterArns,
                })
            )
        );

        const clusterDetails: ClusterInterface[] = [];

        for (const cluster of clusterResponse.clusters ?? []) {
            if (!cluster.clusterName || !cluster.clusterArn) {
                console.log('Cluster does not exist');
                continue;
            }

            const scheduledTasks = await this.schedulerService.getECSScheduledTasks(
                cluster.clusterArn,
                cluster.clusterName
            );
            const services = await this.getClusterServices(cluster.clusterName);

            clusterDetails.push(this.mapClusterDetails(cluster, services, scheduledTasks));
        }

        return clusterDetails;
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

    private mapServiceDetails = (service: any, taskResponse: any, clusterName: string): ServiceInterface => {
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
            deployments: this.mapDeployments(service.deployments),
            deploymentStatus: undefined,
        };
    };

    private mapContainerDefinitions = (taskResponse: any) => {
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

    private mapDeployments = (deployments: any[]) => {
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

    private mapClusterDetails = (cluster: any, services: ServiceInterface[], scheduledTasks: any): ClusterInterface => {
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
