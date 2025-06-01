import {ClusterInterface} from '../aws-entities/cluster.interface';
import {ServiceInterface} from '../aws-entities/service.interface';
import {ScheduledTaskInterface} from '../aws-entities/scheduled-task.interface';
import {InstanceInterface} from '../aws-entities/instance.interface';

export interface AWSResponseInterface {
    clusters: {
        clusters: ClusterInterface[];
    };
    ec2Instances: {
        instances: InstanceInterface[];
    };
    updatedOn: string;
}

// Base response interface
export interface BaseSocketResponse {
    updatedOn: string;
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
