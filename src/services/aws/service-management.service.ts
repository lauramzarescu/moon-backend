import {
    DescribeServicesCommand,
    DescribeTasksCommand,
    ECSClient,
    ListServicesCommand,
    ListTasksCommand,
    UpdateServiceCommand,
} from '@aws-sdk/client-ecs';
import {Service} from '@aws-sdk/client-ecs/dist-types/models';
import {backoffAndRetry} from '../../utils/backoff.util';
import {ServiceInterface} from '../../interfaces/aws-entities/service.interface';
import {TaskDefinitionService} from './task-definition.service';
import {DeploymentMonitorService} from './deployment-monitor.service';
import {ECSMapperService} from './ecs-mapper.service';
import logger from '../../config/logger';

export class ServiceManagementService {
    private readonly ecsClient: ECSClient;
    private readonly taskDefinitionService: TaskDefinitionService;
    private readonly deploymentMonitorService: DeploymentMonitorService;
    private readonly mapperService: ECSMapperService;

    constructor(ecsClient: ECSClient) {
        this.ecsClient = ecsClient;
        this.taskDefinitionService = new TaskDefinitionService(ecsClient);
        this.deploymentMonitorService = new DeploymentMonitorService(ecsClient);
        this.mapperService = new ECSMapperService();
    }

    public async getClusterServices(clusterName: string, checkStuckDeployments = true): Promise<ServiceInterface[]> {
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

        const allServicePromises = serviceBatches.map(batch =>
            this.processBatch(batch, clusterName, checkStuckDeployments)
        );
        const batchResults = await Promise.all(allServicePromises);

        return batchResults.flat();
    }

    public async updateServiceDesiredCount(
        clusterName: string,
        serviceName: string,
        desiredCount: number
    ): Promise<void> {
        await backoffAndRetry(() =>
            this.ecsClient.send(
                new UpdateServiceCommand({
                    cluster: clusterName,
                    service: serviceName,
                    desiredCount: desiredCount,
                })
            )
        );
    }

    public async updateServiceContainerImage(
        clusterName: string,
        serviceName: string,
        containerName: string,
        newImageUri: string
    ): Promise<string> {
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

        const newTaskDefArn = await this.taskDefinitionService.registerNewTaskDefinitionWithUpdatedImage(
            currentTaskDefinitionArn,
            containerName,
            newImageUri
        );

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
    }

    public async restartService(clusterName: string, serviceName: string): Promise<void> {
        await backoffAndRetry(() =>
            this.ecsClient.send(
                new UpdateServiceCommand({
                    cluster: clusterName,
                    service: serviceName,
                    forceNewDeployment: true,
                })
            )
        );
    }

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

        const uniqueTaskDefinitions = new Set(
            serviceDetails.services.map(service => service.taskDefinition).filter(Boolean) as string[]
        );

        const taskDefinitions = await this.taskDefinitionService.getMultipleTaskDefinitions(
            Array.from(uniqueTaskDefinitions)
        );

        const servicePromises = serviceDetails.services.map(service =>
            this.processService(service, clusterName, taskDefinitions, checkStuckDeployments)
        );

        return Promise.all(servicePromises);
    }

    private async processService(
        service: Service,
        clusterName: string,
        taskDefinitions: Map<string, any>,
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

        const serviceData = this.mapperService.mapServiceDetails(service, taskResponse, clusterName);

        const parallelTasks = [];

        parallelTasks.push(
            this.getFailedTasks(clusterName, service.serviceName || '').then(failedTasks => {
                if (failedTasks?.length) {
                    serviceData.failedTasks = failedTasks;
                }
            })
        );

        if (checkStuckDeployments && service.deployments && service.deployments.length > 1) {
            parallelTasks.push(
                this.deploymentMonitorService
                    .isDeploymentStuck(clusterName, service.serviceName || '')
                    .then(deploymentStatus => {
                        if (deploymentStatus.isStuck) {
                            serviceData.deploymentStatus = {
                                isStuck: true,
                                stuckSince: deploymentStatus.details?.startTime,
                                elapsedTimeMs: deploymentStatus.details?.elapsedTimeMs,
                                currentImages: deploymentStatus.details?.currentImages || [],
                                targetImages: deploymentStatus.details?.targetImages || [],
                            };
                        } else {
                            serviceData.deploymentStatus = {
                                isStuck: false,
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
}
