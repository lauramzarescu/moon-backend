import {AuthenticatedSocket} from '../../config/socket.config';

// Client information interface
export interface ClientInfo {
    sockets: AuthenticatedSocket[];
    timeoutId: NodeJS.Timeout | null;
    intervalTime: number;
    isAutomatic: boolean;
    isExecuting?: boolean;
    useProgressiveLoading?: boolean;
}

// Socket service options
export interface SocketServiceOptions {
    includeServices?: boolean;
    includeFailedTasks?: boolean;
    includeStuckDeployments?: boolean;
    clusterNames?: string[];
    useCache?: boolean;
}

// Progressive loading configuration
export interface ProgressiveLoadingConfig {
    enabled: boolean;
    concurrencyLimit?: number;
    delayBetweenClusters?: number;
    batchSize?: number;
}
