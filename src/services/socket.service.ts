import NodeCache from 'node-cache';
import {ec2Client, ecsClient} from '../config/aws.config';
import {AWSResponseInterface} from '../interfaces/responses/aws-response.interface';
import {SOCKET_EVENTS} from '../constants/socket-events';
import {AWS_DATA_CACHE_KEY, CACHE_CONFIG} from '../config/cache.config';
import {EC2Service} from './aws/ec2.service';
import {ECSService} from './aws/ecs.service';
import {AuditLogHelper} from '../controllers/audit-log/audit-log.helper';
import {AuthenticatedSocket} from '../config/socket.config';
import logger from '../config/logger';

export class SocketDetailsService {
    private static instance: SocketDetailsService;
    private static cache: NodeCache = new NodeCache(CACHE_CONFIG);
    private ec2Service = new EC2Service(ec2Client);
    private ecsService = new ECSService(ecsClient);
    private auditHelper = new AuditLogHelper();

    private constructor() {}

    public static getInstance(): SocketDetailsService {
        if (!this.instance) {
            this.instance = new SocketDetailsService();
        }
        return this.instance;
    }

    // Original method for backward compatibility
    public async generateClusterDetails(socket: AuthenticatedSocket): Promise<void> {
        logger.info('[INFO] Generating cluster details (legacy mode)');
        const cachedData = SocketDetailsService.cache.get(AWS_DATA_CACHE_KEY);

        if (cachedData) {
            logger.info('[INFO] Returning cached data');
            (cachedData as any).updatedOn = new Date().toISOString();
            socket.emit(SOCKET_EVENTS.CLUSTERS_UPDATE, cachedData);
            return;
        }

        const startTime = Date.now();

        const instancesStartTime = Date.now();
        const instances = await this.ec2Service.getInstances();
        const instancesEndTime = Date.now();
        const instancesExecutionTime = instancesEndTime - instancesStartTime;

        const clusterDetailsStartTime = Date.now();
        const clusterDetails = await this.ecsService.getClusterDetails(instances);
        const clusterDetailsEndTime = Date.now();
        const clusterDetailsExecutionTime = clusterDetailsEndTime - clusterDetailsStartTime;

        const totalExecutionTime = Date.now() - startTime;

        logger.info(`[PERFORMANCE] EC2 getInstances execution time: ${instancesExecutionTime}ms`);
        logger.info(`[PERFORMANCE] ECS getClusterDetails execution time: ${clusterDetailsExecutionTime}ms`);
        logger.info(`[PERFORMANCE] Total AWS operations execution time: ${totalExecutionTime}ms`);

        const response = {
            clusters: {
                clusters: clusterDetails,
            },
            ec2Instances: {
                instances: instances,
            },
            updatedOn: new Date().toISOString(),
        } as AWSResponseInterface;

        logger.info('[INFO] Caching cluster details');

        SocketDetailsService.cache.set(AWS_DATA_CACHE_KEY, response);
        socket.emit(SOCKET_EVENTS.CLUSTERS_UPDATE, response);
    }

    // Progressive loading method
    public async generateClusterDetailsProgressive(socket: AuthenticatedSocket): Promise<void> {
        logger.info('[INFO] Starting progressive cluster details loading');

        try {
            const totalSteps = 4; // clusters, EC2 inventory, services, scheduled tasks
            let currentStep = 0;

            // Step 1: Send basic cluster information immediately
            currentStep++;
            socket.emit(SOCKET_EVENTS.LOADING_PROGRESS, {
                step: currentStep,
                totalSteps,
                message: 'Loading basic cluster information...',
                progress: (currentStep / totalSteps) * 100,
            });

            const basicClusters = await this.ecsService.getBasicClusterDetails();
            socket.emit(SOCKET_EVENTS.CLUSTERS_BASIC_UPDATE, {
                clusters: basicClusters,
                updatedOn: new Date().toISOString(),
            });

            // Step 2: Send EC2 inventory
            currentStep++;
            socket.emit(SOCKET_EVENTS.LOADING_PROGRESS, {
                step: currentStep,
                totalSteps,
                message: 'Loading EC2 inventory...',
                progress: (currentStep / totalSteps) * 100,
            });

            const instances = await this.ec2Service.getInstances();
            socket.emit(SOCKET_EVENTS.EC2_INVENTORY_UPDATE, {
                instances,
                updatedOn: new Date().toISOString(),
            });

            // Step 3: Load services for each cluster progressively
            currentStep++;
            socket.emit(SOCKET_EVENTS.LOADING_PROGRESS, {
                step: currentStep,
                totalSteps,
                message: 'Loading cluster services...',
                progress: (currentStep / totalSteps) * 100,
            });

            await this.loadClusterServicesProgressive(socket, basicClusters);

            // Step 4: Load scheduled tasks for each cluster
            currentStep++;
            socket.emit(SOCKET_EVENTS.LOADING_PROGRESS, {
                step: currentStep,
                totalSteps,
                message: 'Loading scheduled tasks...',
                progress: (currentStep / totalSteps) * 100,
            });

            await this.loadScheduledTasksProgressive(socket, basicClusters);

            // Notify completion
            socket.emit(SOCKET_EVENTS.LOADING_COMPLETE, {
                message: 'All data loaded successfully',
                updatedOn: new Date().toISOString(),
            });

            logger.info('[INFO] Progressive loading completed');
        } catch (error: any) {
            logger.error('[ERROR] Progressive loading failed:', error);
            socket.emit(SOCKET_EVENTS.CLUSTERS_ERROR, {
                error: 'Failed to load cluster information progressively',
                details: error.message,
            });
        }
    }

    private async loadClusterServicesProgressive(socket: AuthenticatedSocket, clusters: any[]): Promise<void> {
        const clusterPromises = clusters.map(async (cluster, index) => {
            try {
                logger.info(
                    `[PROGRESSIVE] Loading services for cluster: ${cluster.name} (${index + 1}/${clusters.length})`
                );

                const services = await this.ecsService.getClusterServicesOnly(cluster.name);

                socket.emit(SOCKET_EVENTS.CLUSTER_SERVICES_UPDATE, {
                    clusterName: cluster.name,
                    clusterArn: cluster.arn,
                    services,
                    progress: {
                        current: index + 1,
                        total: clusters.length,
                        percentage: ((index + 1) / clusters.length) * 100,
                    },
                    updatedOn: new Date().toISOString(),
                });

                await new Promise(resolve => setTimeout(resolve, 100));
            } catch (error: any) {
                logger.error(`[ERROR] Failed to load services for cluster ${cluster.name}:`, error);
                socket.emit(SOCKET_EVENTS.CLUSTERS_ERROR, {
                    error: `Failed to load services for cluster ${cluster.name}`,
                    clusterName: cluster.name,
                    details: error.message,
                });
            }
        });

        const concurrencyLimit = 3;
        for (let i = 0; i < clusterPromises.length; i += concurrencyLimit) {
            const batch = clusterPromises.slice(i, i + concurrencyLimit);
            await Promise.all(batch);
        }
    }

    private async loadScheduledTasksProgressive(socket: AuthenticatedSocket, clusters: any[]): Promise<void> {
        const clusterPromises = clusters.map(async (cluster, index) => {
            try {
                logger.info(
                    `[PROGRESSIVE] Loading scheduled tasks for cluster: ${cluster.name} (${index + 1}/${clusters.length})`
                );

                const scheduledTasks = await this.ecsService.getClusterScheduledTasksOnly(cluster.arn, cluster.name);

                socket.emit(SOCKET_EVENTS.CLUSTER_SCHEDULED_TASKS_UPDATE, {
                    clusterName: cluster.name,
                    clusterArn: cluster.arn,
                    scheduledTasks,
                    progress: {
                        current: index + 1,
                        total: clusters.length,
                        percentage: ((index + 1) / clusters.length) * 100,
                    },
                    updatedOn: new Date().toISOString(),
                });

                await new Promise(resolve => setTimeout(resolve, 100));
            } catch (error: any) {
                logger.error(`[ERROR] Failed to load scheduled tasks for cluster ${cluster.name}:`, error);
                socket.emit(SOCKET_EVENTS.CLUSTERS_ERROR, {
                    error: `Failed to load scheduled tasks for cluster ${cluster.name}`,
                    clusterName: cluster.name,
                    details: error.message,
                });
            }
        });

        const concurrencyLimit = 3;
        for (let i = 0; i < clusterPromises.length; i += concurrencyLimit) {
            const batch = clusterPromises.slice(i, i + concurrencyLimit);
            await Promise.all(batch);
        }
    }

    // Method to get only EC2 instances (for progressive loading)
    public async getEC2InventoryOnly(socket: AuthenticatedSocket): Promise<void> {
        try {
            logger.info('[INFO] Loading EC2 inventory only');
            const instances = await this.ec2Service.getInstances();

            socket.emit(SOCKET_EVENTS.EC2_INVENTORY_UPDATE, {
                instances,
                updatedOn: new Date().toISOString(),
            });
        } catch (error: any) {
            logger.error('[ERROR] Failed to load EC2 inventory:', error);
            socket.emit(SOCKET_EVENTS.CLUSTERS_ERROR, {
                error: 'Failed to load EC2 inventory',
                details: error.message,
            });
        }
    }

    // Method to refresh specific cluster services
    public async refreshClusterServices(socket: AuthenticatedSocket, clusterName: string): Promise<void> {
        try {
            logger.info(`[INFO] Refreshing services for cluster: ${clusterName}`);
            const services = await this.ecsService.getClusterServicesOnly(clusterName);

            socket.emit(SOCKET_EVENTS.CLUSTER_SERVICES_UPDATE, {
                clusterName,
                services,
                updatedOn: new Date().toISOString(),
            });
        } catch (error: any) {
            logger.error(`[ERROR] Failed to refresh services for cluster ${clusterName}:`, error);
            socket.emit(SOCKET_EVENTS.CLUSTERS_ERROR, {
                error: `Failed to refresh services for cluster ${clusterName}`,
                clusterName,
                details: error.message,
            });
        }
    }

    // Method to refresh specific cluster scheduled tasks
    public async refreshClusterScheduledTasks(
        socket: AuthenticatedSocket,
        clusterName: string,
        clusterArn: string
    ): Promise<void> {
        try {
            logger.info(`[INFO] Refreshing scheduled tasks for cluster: ${clusterName}`);
            const scheduledTasks = await this.ecsService.getClusterScheduledTasksOnly(clusterArn, clusterName);

            socket.emit(SOCKET_EVENTS.CLUSTER_SCHEDULED_TASKS_UPDATE, {
                clusterName,
                clusterArn,
                scheduledTasks,
                updatedOn: new Date().toISOString(),
            });
        } catch (error: any) {
            logger.error(`[ERROR] Failed to refresh scheduled tasks for cluster ${clusterName}:`, error);
            socket.emit(SOCKET_EVENTS.CLUSTERS_ERROR, {
                error: `Failed to refresh scheduled tasks for cluster ${clusterName}`,
                clusterName,
                details: error.message,
            });
        }
    }
}
