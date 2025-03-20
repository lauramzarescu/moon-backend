import {
    DescribeClustersCommand,
    DescribeServicesCommand,
    DescribeTaskDefinitionCommand,
    ECSClient,
    ListClustersCommand,
    ListServicesCommand,
    UpdateServiceCommand
} from "@aws-sdk/client-ecs"
import {backoffAndRetry} from '../../utils/backoff.util'
import {ClusterInterface} from "../../interfaces/aws-entities/cluster.interface";
import {ServiceInterface} from "../../interfaces/aws-entities/service.interface";
import {SchedulerService} from "./scheduler.service";

export class ECSService {
    private readonly ecsClient: ECSClient;
    private readonly schedulerService: SchedulerService

    constructor(ecsClient: ECSClient) {
        this.ecsClient = ecsClient;
        this.schedulerService = new SchedulerService();
    }

    public async getEnvironmentVariables(taskDefinitionArn: string) {
        const response = await backoffAndRetry(() =>
            this.ecsClient.send(new DescribeTaskDefinitionCommand({
                taskDefinition: taskDefinitionArn
            }))
        )

        const containerDefArray = response.taskDefinition?.containerDefinitions
        if (!containerDefArray) {
            throw new Error('Container definition not found')
        }

        return containerDefArray.map((containerDef) => ({
            container: containerDef.name || '',
            environment: containerDef.environment || [],
            environmentFiles: containerDef.environmentFiles || [],
            secrets: containerDef.secrets || []
        }))
    }

    public async getClusterServices(clusterName: string): Promise<ServiceInterface[]> {
        const servicesResponse = await backoffAndRetry(() =>
            this.ecsClient.send(new ListServicesCommand({cluster: clusterName}))
        )

        const serviceNames = servicesResponse.serviceArns?.map((arn: string) => arn.split('/').pop() ?? '') ?? []
        if (serviceNames.length === 0) return []

        const batchSize = 10
        const serviceBatches = []
        for (let i = 0; i < serviceNames.length; i += batchSize) {
            const batch = serviceNames.slice(i, i + batchSize)
            serviceBatches.push(batch)
        }

        const services: ServiceInterface[] = []

        for (const batch of serviceBatches) {
            const serviceDetails = await backoffAndRetry(() =>
                this.ecsClient.send(new DescribeServicesCommand({
                    cluster: clusterName,
                    services: batch
                }))
            )

            for (const service of serviceDetails.services ?? []) {
                const taskDefinitionArn = service?.taskDefinition
                if (!taskDefinitionArn) {
                    throw new Error('Task definition not found')
                }

                const taskResponse = await backoffAndRetry(() =>
                    this.ecsClient.send(new DescribeTaskDefinitionCommand({
                        taskDefinition: taskDefinitionArn
                    }))
                )

                services.push(this.mapServiceDetails(service, taskResponse, clusterName))
            }
        }

        return services
    }

    public async getClusterDetails(instances: any[]): Promise<ClusterInterface[]> {
        const clusters = await backoffAndRetry(() =>
            this.ecsClient.send(new ListClustersCommand({}))
        )

        const clusterResponse = await backoffAndRetry(() =>
            this.ecsClient.send(new DescribeClustersCommand({
                clusters: clusters.clusterArns
            }))
        )

        const clusterDetails: ClusterInterface[] = []

        for (const cluster of clusterResponse.clusters ?? []) {
            if (!cluster.clusterName) {
                console.log('Cluster name is undefined')
                continue;
            }

            const scheduledTasks = await this.schedulerService.getECSScheduledTasks(cluster.clusterName);
            const services = await this.getClusterServices(cluster.clusterName)

            clusterDetails.push(this.mapClusterDetails(cluster, services, scheduledTasks))
        }

        return clusterDetails
    }

    public async updateServiceDesiredCount(clusterName: string, serviceName: string, desiredCount: number): Promise<void> {
        await backoffAndRetry(() =>
            this.ecsClient.send(new UpdateServiceCommand({
                cluster: clusterName,
                service: serviceName,
                desiredCount: desiredCount
            }))
        )
    }

    private mapServiceDetails(service: any, taskResponse: any, clusterName: string): ServiceInterface {
        return {
            name: service.serviceName ?? 'N/A',
            clusterName: clusterName,
            desiredCount: service.desiredCount ?? 0,
            runningCount: service.runningCount ?? 0,
            pendingCount: service.pendingCount ?? 0,
            status: (service.status as "ACTIVE" | "INACTIVE" | "DRAINING") ?? "INACTIVE",
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
        }
    }

    private mapContainerDefinitions(taskResponse: any) {
        return taskResponse.taskDefinition?.containerDefinitions?.map((container: any) => ({
            name: container.name ?? '',
            image: container.image ?? '',
            cpu: container.cpu ?? 0,
            memory: container.memory ?? 0,
            environmentVariables: {
                environment: container.environment?.map((env: any) => ({
                    name: env.name ?? '',
                    value: env.value ?? ''
                })) ?? [],
                environmentFiles: container.environmentFiles ?? [],
                secrets: container.secrets ?? []
            },
        })) ?? []
    }

    private mapDeployments(deployments: any[]) {
        return deployments?.map((deployment: any) => ({
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
    }

    private mapClusterDetails(cluster: any, services: ServiceInterface[], scheduledTasks: any): ClusterInterface {
        return {
            name: cluster.clusterName ?? 'N/A',
            arn: cluster.clusterArn ?? 'N/A',
            status: (cluster.status as "ACTIVE" | "INACTIVE" | "FAILED" | "PROVISIONING" | "DEPROVISIONING") ?? "INACTIVE",
            runningTasks: cluster.runningTasksCount ?? 0,
            pendingTasks: cluster.pendingTasksCount ?? 0,
            registeredContainerInstances: cluster.registeredContainerInstancesCount ?? 0,
            servicesCount: cluster.activeServicesCount ?? 0,
            services,
            scheduledTasks,
        }
    }
}

