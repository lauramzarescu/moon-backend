import {ActionType as ActionTypeEnum, TriggerType as TriggerTypeEnum} from '@prisma/client';
import {z} from 'zod';

export const actionTypeSchema = z.nativeEnum(ActionTypeEnum);
export type ActionType = z.infer<typeof actionTypeSchema>;

export const triggerTypeSchema = z.nativeEnum(TriggerTypeEnum);
export type TriggerType = z.infer<typeof triggerTypeSchema>;

export const addInboundRuleConfigSchema = z.object({
    securityGroupId: z.string().min(1, 'Security Group ID is required'),
    protocol: z.string().min(1, 'Protocol is required'),
    portRange: z.string().min(1, 'Port/Range is required'),
    descriptionTemplate: z.string().optional(),
    ip: z.string().optional(),
});
export type AddInboundRuleConfig = z.infer<typeof addInboundRuleConfigSchema>;

export const removeInboundRuleConfigSchema = z.object({
    securityGroupId: z.string().min(1, 'Security Group ID is required'),
    protocol: z.string().min(1, 'Protocol is required'),
    portRange: z.string().min(1, 'Port/Range is required'),
    ip: z.string().optional(),
});
export type RemoveInboundRuleConfig = z.infer<typeof removeInboundRuleConfigSchema>;

export const removeAllInboundRulesConfigSchema = z.object({
    securityGroupId: z.string().min(1, 'Security Group ID is required'),
    protocol: z.string().optional(),
    portRange: z.string().optional(),
});
export type RemoveAllInboundRulesConfig = z.infer<typeof removeAllInboundRulesConfigSchema>;

export const sendSlackNotificationConfigSchema = z.object({
    channel: z.string().min(1, 'Channel/Type is required'),
    recipient: z.string().min(1, 'Recipient is required'),
    messageTemplate: z.string().min(1, 'Message Template is required'),
});
export type SendNotificationConfig = z.infer<typeof sendSlackNotificationConfigSchema>;

export const sendEmailNotificationConfigSchema = z.object({
    email: z.string().email('Invalid email address'),
    subject: z.string().min(1, 'Subject is required'),
    body: z.string().min(1, 'Body is required'),
});
export type SendEmailNotificationConfig = z.infer<typeof sendEmailNotificationConfigSchema>;

export const scheduledJobConfigSchema = z.object({
    customCronExpression: z.string().min(1, 'Cron expression is required'),
    readableCronExpression: z
        .object({
            description: z.string(),
            nextRun: z.string(),
            nextRuns: z.array(z.string()),
        })
        .optional(),
});
export type ScheduledJobConfig = z.infer<typeof scheduledJobConfigSchema>;

const baseActionDefinitionSchema = z.object({
    id: z.string().uuid(),
    name: z.string().min(1, 'Action name is required'),
    actionType: actionTypeSchema,
    triggerType: triggerTypeSchema,
    config: z.record(z.string(), z.unknown()),
    schedulerConfig: scheduledJobConfigSchema.optional().nullable(),
    enabled: z.boolean(),
});
export type ActionDefinition = z.infer<typeof baseActionDefinitionSchema>;

export const createActionSchema = baseActionDefinitionSchema.omit({id: true});

export const createActionInputSchema = createActionSchema
    .refine(
        data => {
            if (data.actionType === ActionTypeEnum.add_inbound_rule) {
                return addInboundRuleConfigSchema.safeParse(data.config).success;
            }
            if (data.actionType === ActionTypeEnum.send_slack_notification) {
                return sendSlackNotificationConfigSchema.safeParse(data.config).success;
            }
            if (data.actionType === ActionTypeEnum.send_email_notification) {
                return sendEmailNotificationConfigSchema.safeParse(data.config).success;
            }
            if (data.actionType === ActionTypeEnum.remove_inbound_rule) {
                return removeInboundRuleConfigSchema.safeParse(data.config).success;
            }
            if (data.actionType === ActionTypeEnum.remove_all_inbound_rules) {
                return removeAllInboundRulesConfigSchema.safeParse(data.config).success;
            }

            return false;
        },
        {
            message: 'Configuration object does not match the selected action type.',
            path: ['config'],
        }
    )
    .refine(
        data => {
            if (data.triggerType === TriggerTypeEnum.scheduled_job) {
                return scheduledJobConfigSchema.safeParse(data.schedulerConfig).success;
            }
            return true;
        },
        {
            message: 'Scheduler configuration is required for scheduled jobs.',
            path: ['schedulerConfig'],
        }
    );
export type CreateActionDto = z.infer<typeof createActionInputSchema>;

const updateActionBaseSchema = z.object(baseActionDefinitionSchema.shape).omit({id: true});

export const updateActionInputSchema = updateActionBaseSchema
    .refine(
        data => {
            if (data.actionType && data.config) {
                if (data.actionType === ActionTypeEnum.add_inbound_rule) {
                    return addInboundRuleConfigSchema.safeParse(data.config).success;
                }
                if (data.actionType === ActionTypeEnum.send_slack_notification) {
                    return sendSlackNotificationConfigSchema.safeParse(data.config).success;
                }
                if (data.actionType === ActionTypeEnum.send_email_notification) {
                    return sendEmailNotificationConfigSchema.safeParse(data.config).success;
                }
                if (data.actionType === ActionTypeEnum.remove_inbound_rule) {
                    return removeInboundRuleConfigSchema.safeParse(data.config).success;
                }
                if (data.actionType === ActionTypeEnum.remove_all_inbound_rules) {
                    return removeAllInboundRulesConfigSchema.safeParse(data.config).success;
                }
            }

            return false;
        },
        {
            message: 'Provided configuration object does not match the updated action type.',
            path: ['config'],
        }
    )
    .refine(
        data => {
            if (data.triggerType === TriggerTypeEnum.scheduled_job) {
                return scheduledJobConfigSchema.safeParse(data.schedulerConfig).success;
            }
            return true;
        },
        {
            message: 'Scheduler configuration is required for scheduled jobs.',
            path: ['schedulerConfig'],
        }
    );
export type UpdateActionDto = z.infer<typeof updateActionInputSchema>;

const listActionsSchema = z.object(baseActionDefinitionSchema.shape);
export type ListActionsDto = z.infer<typeof listActionsSchema>;

export const actionTypeLabels: Record<ActionType, string> = {
    add_inbound_rule: 'Add Inbound Security Group Rule',
    remove_inbound_rule: 'Remove Inbound Security Group Rule',
    remove_all_inbound_rules: 'Remove All Inbound Security Group Rules',
    send_slack_notification: 'Send Slack Notification',
    send_email_notification: 'Send Email Notification',
};

export const triggerTypeLabels: Record<TriggerType, string> = {
    user_login: 'User Login',
    user_logout: 'User Logout',
    user_created: 'User Created',
    scheduled_job: 'Scheduled Job',
};
