import {z} from 'zod';

export const environmentVariableSchema = z.object({
    name: z.string().min(1, 'Environment variable name is required'),
    value: z.string(),
});

export const getEnvironmentVariablesSchema = z.object({
    clusterName: z.string().min(1, 'Cluster name is required'),
    serviceName: z.string().min(1, 'Service name is required'),
    containerName: z.string().min(1, 'Container name is required'),
});

export const addEnvironmentVariablesSchema = z.object({
    clusterName: z.string().min(1, 'Cluster name is required'),
    serviceName: z.string().min(1, 'Service name is required'),
    containerName: z.string().min(1, 'Container name is required'),
    environmentVariables: z.array(environmentVariableSchema).min(1, 'At least one environment variable is required'),
});

export const editEnvironmentVariablesSchema = z.object({
    clusterName: z.string().min(1, 'Cluster name is required'),
    serviceName: z.string().min(1, 'Service name is required'),
    containerName: z.string().min(1, 'Container name is required'),
    environmentVariables: z.array(environmentVariableSchema).min(1, 'At least one environment variable is required'),
});

export const removeEnvironmentVariablesSchema = z.object({
    clusterName: z.string().min(1, 'Cluster name is required'),
    serviceName: z.string().min(1, 'Service name is required'),
    containerName: z.string().min(1, 'Container name is required'),
    variableNames: z
        .array(z.string().min(1, 'Variable name cannot be empty'))
        .min(1, 'At least one variable name is required'),
});

export const replaceEnvironmentVariablesSchema = z.object({
    clusterName: z.string().min(1, 'Cluster name is required'),
    serviceName: z.string().min(1, 'Service name is required'),
    containerName: z.string().min(1, 'Container name is required'),
    environmentVariables: z.array(environmentVariableSchema),
});

export const bulkUpdateEnvironmentVariablesSchema = z.object({
    clusterName: z.string().min(1, 'Cluster name is required'),
    serviceName: z.string().min(1, 'Service name is required'),
    operations: z
        .array(
            z.object({
                containerName: z.string().min(1, 'Container name is required'),
                environmentVariables: z.array(environmentVariableSchema),
            })
        )
        .min(1, 'At least one operation is required'),
});
