import {z} from 'zod';

export const linkRepositoryBodySchema = z.object({
    repo: z.string().min(1),
    serviceArn: z.string(),
});
export const linkRepositoryParamsSchema = z.object({
    id: z.string().uuid(),
});
