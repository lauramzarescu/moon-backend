export const SOCKET_EVENTS = {
    CLUSTERS_UPDATE: 'clusters-update',
    CLUSTERS_ERROR: 'clusters-error',

    // Progressive loading events
    CLUSTERS_BASIC_UPDATE: 'clusters-basic-update',
    CLUSTER_SERVICES_UPDATE: 'cluster-services-update',
    CLUSTER_SCHEDULED_TASKS_UPDATE: 'cluster-scheduled-tasks-update',
    EC2_INVENTORY_UPDATE: 'ec2-inventory-update',

    LOADING_PROGRESS: 'loading-progress',
    LOADING_COMPLETE: 'loading-complete',

    TOGGLE_PROGRESSIVE_LOADING: 'toggle-progressive-loading',
    REFRESH_CLUSTER_SERVICES: 'refresh-cluster-services',
    REFRESH_CLUSTER_SCHEDULED_TASKS: 'refresh-cluster-scheduled-tasks',
    GET_EC2_INVENTORY: 'get-ec2-inventory',

    INTERVAL_UPDATED: 'interval-updated',
    INTERVAL_SET: 'set-interval',

    MANUAL_REFRESH: 'manual-refresh',
    DISCONNECT: 'disconnect',
} as const;
