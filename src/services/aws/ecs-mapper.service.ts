import {DescribeTaskDefinitionCommandOutput} from '@aws-sdk/client-ecs';
import {Cluster, Service} from '@aws-sdk/client-ecs/dist-types/models';
import {Deployment} from '@aws-sdk/client-ecs/dist-types/models/models_0';
import {ServiceInterface} from '../../interfaces/aws-entities/service.interface';
import {ClusterInterface} from '../../interfaces/aws-entities/cluster.interface';
import {ScheduledTaskInterface} from '../../interfaces/aws-entities/scheduled-task.interface';

export class ECSMapperService {
    public mapServiceDetails(
        service: Service,
        taskResponse: DescribeTaskDefinitionCommandOutput,
        clusterName: string
    ): ServiceInterface {
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
    }

    public mapClusterDetails(
        cluster: Cluster,
        services: ServiceInterface[],
        scheduledTasks: ScheduledTaskInterface[]
    ): ClusterInterface {
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
    }

    private mapContainerDefinitions(taskResponse: DescribeTaskDefinitionCommandOutput) {
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
    }

    private mapDeployments(deployments: Deployment[]) {
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
    }
}
