import {Socket} from 'socket.io';
import NodeCache from "node-cache";
import {ec2Client, ecsClient} from "../config/aws.config";
import {AWSResponseInterface} from "../interfaces/responses/aws-response.interface";
import {SOCKET_EVENTS} from "../constants/socket-events";
import {AWS_DATA_CACHE_KEY, CACHE_CONFIG} from "../config/cache.config";
import {EC2Service} from './aws/ec2.service';
import {ECSService} from "./aws/ecs.service";

export class SocketDetailsService {
    private static instance: SocketDetailsService;
    private static cache: NodeCache = new NodeCache(CACHE_CONFIG);
    private ec2Service = new EC2Service(ec2Client);
    private ecsService = new ECSService(ecsClient);

    private constructor() {
    }

    public static getInstance(): SocketDetailsService {
        if (!this.instance) {
            this.instance = new SocketDetailsService();
        }
        return this.instance;
    }

    public async generateClusterDetails(socket: Socket): Promise<void> {
        console.log('[INFO] Generating cluster details');
        const cachedData = SocketDetailsService.cache.get(AWS_DATA_CACHE_KEY);

        if (cachedData) {
            console.log('[INFO] Returning cached data');
            (cachedData as any).updatedOn = new Date().toISOString();
            socket.emit(SOCKET_EVENTS.CLUSTERS_UPDATE, cachedData);
            return;
        }

        const instances = await this.ec2Service.getInstances();
        const clusterDetails = await this.ecsService.getClusterDetails(instances);

        const response = {
            clusters: {
                clusters: clusterDetails,
            },
            ec2Instances: {
                instances: instances,
            },
            updatedOn: new Date().toISOString()
        } as AWSResponseInterface;

        console.log('[INFO] Caching cluster details');
        SocketDetailsService.cache.set(AWS_DATA_CACHE_KEY, response);

        socket.emit(SOCKET_EVENTS.CLUSTERS_UPDATE, response);
    }
}
