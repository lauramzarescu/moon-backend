import {DescribeClustersCommand, ECSClient, ListClustersCommand} from '@aws-sdk/client-ecs';
import {backoffAndRetry} from '../../utils/backoff.util';
import {ClusterInterface} from '../../interfaces/aws-entities/cluster.interface';
import {SchedulerService} from './scheduler.service';
import {ServiceManagementService} from './service-management.service';
import {ECSMapperService} from './ecs-mapper.service';
import {ScheduledTaskInterface} from '../../interfaces/aws-entities/scheduled-task.interface';
import logger from '../../config/logger';

export class ClusterManagementService {
    private readonly ecsClient: ECSClient;
    private readonly schedulerService: SchedulerService;
    private readonly serviceManagementService: ServiceManagementService;
    private readonly mapperService: ECSMapperService;

    constructor(ecsClient: ECSClient) {
        this.ecsClient = ecsClient;
        this.schedulerService = new SchedulerService();
        this.serviceManagementService = new ServiceManagementService(ecsClient);
        this.mapperService = new ECSMapperService();
    }

    public async getBasicClusterDetails(): Promise<ClusterInterface[]> {
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
    }

    public async getClusterScheduledTasksOnly(
        clusterArn: string,
        clusterName: string
    ): Promise<ScheduledTaskInterface[]> {
        logger.info(`[ECS] Fetching scheduled tasks for cluster: ${clusterName}`);
        return await this.schedulerService.getECSScheduledTasks(clusterArn, clusterName);
    }

    public async getClusterDetails(instances: any[]): Promise<ClusterInterface[]> {
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

        const clusterPromises = clusterResponse.clusters.map(async cluster => {
            if (!cluster.clusterName || !cluster.clusterArn) {
                logger.info('Cluster does not exist');
                return null;
            }

            const [scheduledTasks, services] = await Promise.all([
                this.schedulerService.getECSScheduledTasks(cluster.clusterArn, cluster.clusterName),
                this.serviceManagementService.getClusterServices(cluster.clusterName),
            ]);

            return this.mapperService.mapClusterDetails(cluster, services, scheduledTasks);
        });

        const results = await Promise.all(clusterPromises);
        return results.filter(Boolean) as ClusterInterface[];
    }
}
