export enum PermissionEnum {
    USER_CREATE = 'user:create',
    USER_READ = 'user:read',
    USER_WRITE = 'user:write',
    USER_DELETE = 'user:delete',

    SAML_CONFIGURATION_CREATE = 'saml:configuration:create',
    SAML_CONFIGURATION_READ = 'saml:configuration:read',
    SAML_CONFIGURATION_WRITE = 'saml:configuration:write',
    SAML_CONFIGURATION_DELETE = 'saml:configuration:delete',

    ACCESS_CONTROL_CREATE = 'access_control:create',
    ACCESS_CONTROL_READ = 'access_control:read',
    ACCESS_CONTROL_WRITE = 'access_control:write',
    ACCESS_CONTROL_DELETE = 'access_control:delete',

    AWS_CLUSTER_CREATE = 'aws:cluster:create',
    AWS_CLUSTER_READ = 'aws:cluster:read',
    AWS_CLUSTER_WRITE = 'aws:cluster:write',
    AWS_CLUSTER_DELETE = 'aws:cluster:delete',

    AWS_SERVICE_CREATE = 'aws:service:create',
    AWS_SERVICE_READ = 'aws:service:read',
    AWS_SERVICE_WRITE = 'aws:service:write',
    AWS_SERVICE_DELETE = 'aws:service:delete',

    AWS_SCHEDULED_TASK_CREATE = 'aws:scheduled_task:create',
    AWS_SCHEDULED_TASK_READ = 'aws:scheduled_task:read',
    AWS_SCHEDULED_TASK_WRITE = 'aws:scheduled_task:write',
    AWS_SCHEDULED_TASK_DELETE = 'aws:scheduled_task:delete',
}