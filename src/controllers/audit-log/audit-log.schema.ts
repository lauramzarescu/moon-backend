import {z} from 'zod';
import {AuditLogEnum} from '../../enums/audit-log/audit-log.enum';

export const awsUpdateImageSchema = z.object({
    service: z.string().optional(),
    cluster: z.string().optional(),
    newServiceImage: z.string().optional(),
    oldServiceImage: z.string().optional(),
});

export const auditLogSchema = z.object({
    id: z.string().uuid(),
    userId: z.string().uuid(),
    organizationId: z.string().uuid(),
    action: z.nativeEnum(AuditLogEnum),
    details: z.object({
        ip: z.string().default('-').optional(),
        info: z
            .object({
                email: z.string().email().optional(),
                objectOld: z.unknown().optional(),
                objectNew: z.unknown().optional(),

                // For AWS Update Image
                ...awsUpdateImageSchema.shape,
            })
            .and(z.record(z.string(), z.unknown()))
            .optional(),
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
