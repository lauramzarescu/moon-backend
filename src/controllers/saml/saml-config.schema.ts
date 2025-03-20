import {z} from 'zod';

export const samlConfigSchema = z.object({
    metadataUrl: z.string().url(),
    privateKey: z.string().min(1),
    x509Certificate: z.string().min(1),
    entityId: z.string().min(1),
});

export const samlConfigUpdateSchema = z.object({
    metadataUrl: z.string().url().optional(),
    privateKey: z.string().min(1).optional(),
    x509Certificate: z.string().min(1).optional(),
    entityId: z.string().min(1).optional(),
})

export type SamlConfigInput = z.infer<typeof samlConfigSchema>;
