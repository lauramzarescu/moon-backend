export enum AuditLogEnum {
    // User events
    USER_LOGIN = 'user:login',
    USER_LOGOUT = 'user:logout',
    USER_CREATED = 'user:created',
    USER_UPDATED = 'user:updated',
    USER_DELETED = 'user:deleted',
    USER_2FA_ATTEMPT = 'user:2fa:attempt',
    USER_2FA_ENABLED = 'user:2fa:enabled',
    USER_2FA_DISABLED = 'user:2fa:disabled',
    USER_PASSWORD_RESET = 'user:password:reset',
    USER_PASSWORD_CHANGED = 'user:password:changed',

    // Action events
    ACTION_CREATED = 'action:created',
    ACTION_UPDATED = 'action:updated',
    ACTION_DELETED = 'action:deleted',
    ACTION_EXECUTED = 'action:executed',

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

    // Notification events
    NOTIFICATION_EMAIL_SENT = 'notification:email:sent',
    NOTIFICATION_SLACK_SENT = 'notification:slack:sent',

    // Scheduled events
    SCHEDULED_JOB_STARTED = 'scheduled:job:started',
}
