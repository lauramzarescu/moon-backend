export const SOCKET_EVENTS = {
    // Legacy events
    CLUSTERS_UPDATE: 'clusters-update',
    CLUSTERS_ERROR: 'clusters-error',

    // Progressive loading events
    CLUSTERS_BASIC_UPDATE: 'clusters-basic-update',
    EC2_INVENTORY_UPDATE: 'ec2-inventory-update',
    CLUSTER_SERVICES_UPDATE: 'cluster-services-update',
    CLUSTER_SCHEDULED_TASKS_UPDATE: 'cluster-scheduled-tasks-update',

    // Progress tracking events
    LOADING_PROGRESS: 'loading-progress',
    LOADING_COMPLETE: 'loading-complete',

    // Interval management events
    INTERVAL_UPDATED: 'interval-updated',
    INTERVAL_SET: 'set-interval',

    // Manual control events
    MANUAL_REFRESH: 'manual-refresh',
    DISCONNECT: 'disconnect',

    // Progressive loading control events
    TOGGLE_PROGRESSIVE_LOADING: 'toggle-progressive-loading',
    REFRESH_CLUSTER_SERVICES: 'refresh-cluster-services',
    REFRESH_CLUSTER_SCHEDULED_TASKS: 'refresh-cluster-scheduled-tasks',
    GET_EC2_INVENTORY: 'get-ec2-inventory',
} as const;

// Type for socket event names
export type SocketEventName = (typeof SOCKET_EVENTS)[keyof typeof SOCKET_EVENTS];
