import {
    DescribeServicesCommand,
    DescribeTaskDefinitionCommand,
    DescribeTasksCommand,
    ECSClient,
    ListTasksCommand,
} from '@aws-sdk/client-ecs';
import {backoffAndRetry} from '../../utils/backoff.util';
import logger from '../../config/logger';

export class DeploymentMonitorService {
    private readonly ecsClient: ECSClient;
    private readonly deploymentTimeoutMs: number;

    constructor(ecsClient: ECSClient, deploymentTimeoutMinutes = 5) {
        this.ecsClient = ecsClient;
        this.deploymentTimeoutMs = deploymentTimeoutMinutes * 60 * 1000;
    }

    /**
     * Checks if a service deployment is stuck
     * @param clusterName The ECS cluster name
     * @param serviceName The ECS service name
     * @returns Object with isStuck status and details
     */
    public async isDeploymentStuck(
        clusterName: string,
        serviceName: string
    ): Promise<{
        isStuck: boolean;
        details?: {
            deploymentId: string;
            startTime: Date;
            elapsedTimeMs: number;
            pendingCount: number;
            runningCount: number;
            desiredCount: number;
            currentImages: {containerName: string; image: string}[];
            targetImages: {containerName: string; image: string}[];
        };
    }> {
        try {
            // Get service details
            const serviceResponse = await backoffAndRetry(() =>
                this.ecsClient.send(
                    new DescribeServicesCommand({
                        cluster: clusterName,
                        services: [serviceName],
                    })
                )
            );

            if (!serviceResponse.services || serviceResponse.services.length === 0) {
                throw new Error(`Service ${serviceName} not found in cluster ${clusterName}`);
            }

            const service = serviceResponse.services[0];

            // Check if there's an ongoing deployment
            if (!service.deployments || service.deployments.length <= 1) {
                return {isStuck: false}; // No deployment in progress
            }

            // Primary deployment is the one being rolled out
            const primaryDeployment = service.deployments.find(d => d.status === 'PRIMARY');
            // Active deployment is the one currently serving traffic
            const activeDeployment = service.deployments.find(d => d.status !== 'PRIMARY');

            if (!primaryDeployment || !activeDeployment || !primaryDeployment.createdAt) {
                return {isStuck: false}; // Not enough info to determine
            }

            // Calculate how long the deployment has been running
            const now = new Date();
            const deploymentStartTime = primaryDeployment.createdAt;
            const elapsedTimeMs = now.getTime() - deploymentStartTime.getTime();

            // Get container images for both task definitions
            const currentImages = await this.getContainerImagesForTaskDefinition(activeDeployment.taskDefinition || '');
            const targetImages = await this.getContainerImagesForTaskDefinition(primaryDeployment.taskDefinition || '');

            // Check if the deployment has been running for too long
            const isStuck =
                elapsedTimeMs > this.deploymentTimeoutMs &&
                (primaryDeployment.runningCount ?? 0) < (primaryDeployment.desiredCount ?? 0);

            return {
                isStuck,
                details: {
                    deploymentId: primaryDeployment.id || '',
                    startTime: deploymentStartTime,
                    elapsedTimeMs,
                    pendingCount: primaryDeployment.pendingCount || 0,
                    runningCount: primaryDeployment.runningCount || 0,
                    desiredCount: primaryDeployment.desiredCount || 0,
                    currentImages,
                    targetImages,
                },
            };
        } catch (error: any) {
            logger.error('Error checking deployment status:', error);
            throw error;
        }
    }

    /**
     * Gets container images for a task definition
     * @param taskDefinitionArn The task definition ARN
     * @returns Array of container name and image pairs
     */
    private async getContainerImagesForTaskDefinition(taskDefinitionArn: string): Promise<
        {
            containerName: string;
            image: string;
        }[]
    > {
        try {
            if (!taskDefinitionArn) {
                return [];
            }

            const taskDefResponse = await backoffAndRetry(() =>
                this.ecsClient.send(
                    new DescribeTaskDefinitionCommand({
                        taskDefinition: taskDefinitionArn,
                    })
                )
            );

            const containerDefs = taskDefResponse.taskDefinition?.containerDefinitions || [];

            return containerDefs.map(container => ({
                containerName: container.name || 'unknown',
                image: container.image || 'unknown',
            }));
        } catch (error: any) {
            logger.error(`Error getting container images for task definition ${taskDefinitionArn}:`, error);
            return [];
        }
    }

    /**
     * Gets detailed information about tasks in a service
     * @param clusterName The ECS cluster name
     * @param serviceName The ECS service name
     */
    public async getTasksInfo(clusterName: string, serviceName: string) {
        try {
            const tasksResponse = await this.ecsClient.send(
                new ListTasksCommand({
                    cluster: clusterName,
                    serviceName: serviceName,
                })
            );

            if (!tasksResponse.taskArns || tasksResponse.taskArns.length === 0) {
                return [];
            }

            const taskDetails = await this.ecsClient.send(
                new DescribeTasksCommand({
                    cluster: clusterName,
                    tasks: tasksResponse.taskArns,
                })
            );

            return taskDetails.tasks || [];
        } catch (error: any) {
            logger.error('Error getting tasks info:', error);
            throw error;
        }
    }
}
