import {z} from 'zod';

export const serviceArnParamSchema = z.object({
    id: z.string(),
});
export const latestCommitByBranchParamSchema = z.object({
    id: z.string(),
    branch: z.string().min(1),
});
