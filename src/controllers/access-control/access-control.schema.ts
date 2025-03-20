import {z} from 'zod';

export const accessControlSchema = z.object({
    id: z.string(),
    email: z.string().email(),
    organizationId: z.string().uuid(),
    description: z.string().optional(),
    isAllowed: z.boolean().default(true)
})

export const accessControlCreateSchema = accessControlSchema.omit({
    id: true,
    organizationId: true,
    isAllowed: true
});

export type AccessControlInput = z.infer<typeof accessControlSchema>;
export type AccessControlCreateInput = z.infer<typeof accessControlCreateSchema>;
