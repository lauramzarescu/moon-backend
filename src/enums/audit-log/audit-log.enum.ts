export enum AuditLogEnum {
    // User events
    USER_LOGIN = 'user:login',
    USER_LOGOUT = 'user:logout',
    USER_CREATED = 'user:created',
    USER_INVITED = 'user:invited',
    USER_UPDATED = 'user:updated',
    USER_DELETED = 'user:deleted',

    USER_2FA_ATTEMPT = 'user:2fa:attempt',
    USER_2FA_ENABLED = 'user:2fa:enabled',
    USER_2FA_DISABLED = 'user:2fa:disabled',
    USER_2FA_SESSION_VERIFIED = 'user:2fa:session:verified',
    USER_2FA_RESET_REQUESTED = 'user:2fa:reset:requested',
    USER_2FA_RESET = 'user:2fa:reset',

    USER_AUTHORIZED_DEVICE_REMOVED = 'user:authorized:device:removed',

    USER_PASSWORD_RESET_REQUESTED = 'user:password:reset:requested',
    USER_PASSWORD_RESET = 'user:password:reset',
    USER_PASSWORD_ADMIN_RESET = 'user:password:admin:reset',
    USER_PASSWORD_CHANGED = 'user:password:changed',

    USER_EXPORTED = 'user:exported',
    USER_IMPORTED = 'user:imported',

    // Organization events
    ORGANIZATION_UPDATED = 'organization:updated',

    // Action events
    ACTION_CREATED = 'action:created',
    ACTION_UPDATED = 'action:updated',
    ACTION_DELETED = 'action:deleted',
    ACTION_EXECUTED = 'action:executed',
    ACTION_EXPORTED = 'action:exported',
    ACTION_IMPORTED = 'action:imported',

    // SAML events
    SAML_CONFIG_CREATED = 'saml:config:created',
    SAML_CONFIG_UPDATED = 'saml:config:updated',
    SAML_CONFIG_DELETED = 'saml:config:deleted',

    // Access Control events
    ACCESS_CONTROL_CREATED = 'access:control:created',
    ACCESS_CONTROL_UPDATED = 'access:control:updated',
    ACCESS_CONTROL_DELETED = 'access:control:deleted',

    // AWS events
    AWS_CLUSTER_CREATED = 'aws:cluster:created',
    AWS_CLUSTER_UPDATED = 'aws:cluster:updated',
    AWS_CLUSTER_DELETED = 'aws:cluster:deleted',
    AWS_INFO_GENERATED = 'aws:info:generated',

    AWS_SERVICE_CREATED = 'aws:service:created',
    AWS_SERVICE_UPDATED = 'aws:service:updated',
    AWS_SERVICE_DELETED = 'aws:service:deleted',
    AWS_SERVICE_RESTARTED = 'aws:service:restarted',

    AWS_TASK_CREATED = 'aws:task:created',
    AWS_TASK_UPDATED = 'aws:task:updated',
    AWS_TASK_DELETED = 'aws:task:deleted',

    // Security events
    SECURITY_GROUP_RULE_ADDED = 'security:group:rule:added',
    SECURITY_GROUP_RULE_REMOVED = 'security:group:rule:removed',
    SECURITY_GROUP_RULE_REMOVE_ALL = 'security:group:rules:remove',

    // Notification events
    NOTIFICATION_EMAIL_SENT = 'notification:email:sent',
    NOTIFICATION_SLACK_SENT = 'notification:slack:sent',

    // Scheduled events
    SCHEDULED_JOB_STARTED = 'scheduled:job:started',
}
