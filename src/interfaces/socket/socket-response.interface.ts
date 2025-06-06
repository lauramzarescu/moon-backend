import {ClusterInterface} from '../aws-entities/cluster.interface';
import {ServiceInterface} from '../aws-entities/service.interface';
import {ScheduledTaskInterface} from '../aws-entities/scheduled-task.interface';
import {InstanceInterface} from '../aws-entities/instance.interface';

export interface ClientInfoResponse {
    intervalTime: number; // in seconds
    automaticIntervalTime?: number; // in seconds
    isAutomatic: boolean;
    isExecuting: boolean;
    useProgressiveLoading: boolean;
    connectedSockets: number;
}

// Base response interface
export interface BaseSocketResponse {
    updatedOn: string;
    clientInfo: ClientInfoResponse;
}

export interface AWSResponseInterface extends BaseSocketResponse {
    clusters: {
        clusters: ClusterInterface[];
    };
    ec2Instances: {
        instances: InstanceInterface[];
    };
}

// Progressive loading responses
export interface ClustersBasicResponse extends BaseSocketResponse {
    clusters: ClusterInterface[];
}

export interface EC2InventoryResponse extends BaseSocketResponse {
    instances: InstanceInterface[];
}

export interface ClusterServicesResponse extends BaseSocketResponse {
    clusterName: string;
    clusterArn?: string;
    services: ServiceInterface[];
    progress?: {
        current: number;
        total: number;
        percentage: number;
    };
}

export interface ClusterScheduledTasksResponse extends BaseSocketResponse {
    clusterName: string;
    clusterArn: string;
    scheduledTasks: ScheduledTaskInterface[];
    progress?: {
        current: number;
        total: number;
        percentage: number;
    };
}

// Loading progress response
export interface LoadingProgressResponse {
    step: number;
    totalSteps: number;
    message: string;
    progress: number; // percentage 0-100
    clientInfo: ClientInfoResponse;
}

// Loading complete response
export interface LoadingCompleteResponse extends BaseSocketResponse {
    message: string;
}

// Error response
export interface SocketErrorResponse {
    error: string;
    clusterName?: string;
    details?: string | any;
    clientInfo?: ClientInfoResponse;
}

// Union type for all possible socket responses
export type SocketResponse =
    | AWSResponseInterface
    | ClustersBasicResponse
    | EC2InventoryResponse
    | ClusterServicesResponse
    | ClusterScheduledTasksResponse
    | LoadingProgressResponse
    | LoadingCompleteResponse
    | SocketErrorResponse;
