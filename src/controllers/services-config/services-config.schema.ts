import {z} from 'zod';
import {ServiceType} from '@prisma/client';

export const servicesConfigSchema = z.object({
    name: z.string().min(1),
    type: z.nativeEnum(ServiceType),
    config: z.any(),
    organizationId: z.string().optional(),
});

export type ServicesConfigInput = z.infer<typeof servicesConfigSchema>;
