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

const baseActionDefinitionSchema = z.object({
    id: z.string().uuid(),
    name: z.string().min(1, 'Action name is required'),
    actionType: actionTypeSchema,
    triggerType: triggerTypeSchema,
    config: z.record(z.string(), z.unknown()),
    enabled: z.boolean(),
});
export type ActionDefinition = z.infer<typeof baseActionDefinitionSchema>;

export const createActionSchema = baseActionDefinitionSchema.omit({id: true});

export const createActionInputSchema = z
    .object({
        name: z.string().min(1, 'Action name is required'),
        actionType: actionTypeSchema,
        triggerType: triggerTypeSchema,
        enabled: z.boolean(),
        config: z.record(z.string(), z.unknown()),
    })
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
            return true;
        },
        {
            message: 'Configuration object does not match the selected action type.',
            path: ['config'],
        }
    );
export type CreateActionDto = z.infer<typeof createActionInputSchema>;

const updateActionBaseSchema = z
    .object({
        name: z.string().min(1, 'Action name is required'),
        actionType: actionTypeSchema,
        triggerType: triggerTypeSchema,
        enabled: z.boolean(),
        config: z.record(z.string(), z.unknown()),
    })
    .partial();

export const updateActionInputSchema = updateActionBaseSchema.refine(
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
        }
        return true;
    },
    {
        message: 'Provided configuration object does not match the updated action type.',
        path: ['config'],
    }
);
export type UpdateActionDto = z.infer<typeof updateActionInputSchema>;

export const actionTypeLabels: Record<ActionType, string> = {
    add_inbound_rule: 'Add Inbound Security Group Rule',
    send_slack_notification: 'Send Slack Notification',
    send_email_notification: 'Send Email Notification',
};

export const triggerTypeLabels: Record<TriggerType, string> = {
    user_login: 'User Login',
    user_logout: 'User Logout',
    user_created: 'User Created',
};
