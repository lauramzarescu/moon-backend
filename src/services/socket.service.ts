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

    public async generateClusterDetails(socket: AuthenticatedSocket): Promise<void> {
        logger.info('[INFO] Generating cluster details');
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

        // await this.auditHelper.create({
        //     userId: socket.userId,
        //     organizationId: socket.userInfo?.organizationId || 'unknown',
        //     action: AuditLogEnum.AWS_INFO_GENERATED,
        //     details: {
        //         ip: socket.ipAddress || '-',
        //         info: {
        //             userAgent: '-',
        //             email: socket.userInfo?.email || '-',
        //         },
        //     },
        // });
    }
}
