import {z} from 'zod';

export const serviceUpdateCountSchema = z.object({
    clusterName: z.string().min(1, 'Cluster name is required'),
    serviceName: z.string().min(1, 'Service name is required'),
    desiredCount: z.number().int().min(0, 'Desired count must be 0 or greater'),
});

export const serviceRestartSchema = serviceUpdateCountSchema.omit({desiredCount: true});

export const serviceUpdateImageSchema = z.object({
    clusterName: z.string().min(1, 'Cluster name is required'),
    serviceName: z.string().min(1, 'Service name is required'),
    containerName: z.string().min(1, 'Container name is required'),
    newImageUri: z.string().min(1, 'New image URI is required'),
    oldImageUri: z.string().min(1, 'Old image URI is required'),
});

export type ServiceUpdateCountInput = z.infer<typeof serviceUpdateCountSchema>;
export type ServiceUpdateImageInput = z.infer<typeof serviceUpdateImageSchema>;
