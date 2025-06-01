import {
    AWSResponseInterface,
    ClustersBasicResponse,
    ClusterScheduledTasksResponse,
    ClusterServicesResponse,
    EC2InventoryResponse,
    LoadingCompleteResponse,
    LoadingProgressResponse,
    SocketErrorResponse,
} from './socket-response.interface';

// Socket event payload interfaces
export interface IntervalSetPayload {
    intervalTime: number; // -1 for automatic, 0 to stop, positive number for manual interval
}

export interface IntervalUpdatedPayload {
    intervalTime: number;
}

export interface RefreshClusterServicesPayload {
    clusterName: string;
}

export interface RefreshClusterScheduledTasksPayload {
    clusterName: string;
    clusterArn: string;
}

export interface ToggleProgressiveLoadingPayload {
    enabled: boolean;
}

// Socket event map for type safety
export interface SocketEventMap {
    // Client to Server events
    'set-interval': (payload: IntervalSetPayload) => void;
    'manual-refresh': () => void;
    'toggle-progressive-loading': (payload: ToggleProgressiveLoadingPayload) => void;
    'refresh-cluster-services': (payload: RefreshClusterServicesPayload) => void;
    'refresh-cluster-scheduled-tasks': (payload: RefreshClusterScheduledTasksPayload) => void;
    'get-ec2-inventory': () => void;
    disconnect: () => void;

    // Server to Client events
    'clusters-update': (data: AWSResponseInterface) => void;
    'clusters-basic-update': (data: ClustersBasicResponse) => void;
    'ec2-inventory-update': (data: EC2InventoryResponse) => void;
    'cluster-services-update': (data: ClusterServicesResponse) => void;
    'cluster-scheduled-tasks-update': (data: ClusterScheduledTasksResponse) => void;
    'loading-progress': (data: LoadingProgressResponse) => void;
    'loading-complete': (data: LoadingCompleteResponse) => void;
    'clusters-error': (data: SocketErrorResponse) => void;
    'interval-updated': (data: IntervalUpdatedPayload) => void;
}
