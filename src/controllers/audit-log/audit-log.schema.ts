import {z} from 'zod';
import {AuditLogEnum} from '../../enums/audit-log/audit-log.enum';

export const auditLogSchema = z.object({
    id: z.string().uuid(),
    userId: z.string().uuid(),
    organizationId: z.string().uuid(),
    action: z.nativeEnum(AuditLogEnum),
    details: z.object({
        ip: z.string().default('-').optional(),
        info: z.record(z.string(), z.unknown()).optional(),
    }),
    createdAt: z.date().default(() => new Date()),
    updatedAt: z.date().default(() => new Date()),
});

export const createAuditLogSchema = auditLogSchema.omit({
    id: true,
    createdAt: true,
    updatedAt: true,
});

export type AuditLog = z.infer<typeof auditLogSchema>;
export type CreateAuditLog = z.infer<typeof createAuditLogSchema>;
