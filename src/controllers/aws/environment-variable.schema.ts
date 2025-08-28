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

// New versioning schemas
export const getVersionsListSchema = z.object({
    clusterName: z.string().min(1, 'Cluster name is required'),
    serviceName: z.string().min(1, 'Service name is required'),
    containerName: z.string().min(1, 'Container name is required'),
});

export const getVariablesFromVersionSchema = z.object({
    clusterName: z.string().min(1, 'Cluster name is required'),
    serviceName: z.string().min(1, 'Service name is required'),
    containerName: z.string().min(1, 'Container name is required'),
    revision: z.string().transform(val => {
        const num = parseInt(val, 10);
        if (isNaN(num) || num < 1) {
            throw new Error('Revision must be a positive integer');
        }
        return num;
    }),
});

export const copyVariablesBetweenServicesSchema = z.object({
    sourceClusterName: z.string().min(1, 'Source cluster name is required'),
    sourceServiceName: z.string().min(1, 'Source service name is required'),
    sourceContainerName: z.string().min(1, 'Source container name is required'),
    targetClusterName: z.string().min(1, 'Target cluster name is required'),
    targetServiceName: z.string().min(1, 'Target service name is required'),
    targetContainerName: z.string().min(1, 'Target container name is required'),
    sourceRevision: z.number().int().min(1).optional(),
});

export const rollbackToVersionSchema = z.object({
    clusterName: z.string().min(1, 'Cluster name is required'),
    serviceName: z.string().min(1, 'Service name is required'),
    containerName: z.string().min(1, 'Container name is required'),
    targetRevision: z.number().int().min(1, 'Target revision must be a positive integer'),
});

export const compareVersionsSchema = z.object({
    clusterName: z.string().min(1, 'Cluster name is required'),
    serviceName: z.string().min(1, 'Service name is required'),
    containerName: z.string().min(1, 'Container name is required'),
    revision1: z.string().transform(val => {
        const num = parseInt(val, 10);
        if (isNaN(num) || num < 1) {
            throw new Error('Revision 1 must be a positive integer');
        }
        return num;
    }),
    revision2: z.string().transform(val => {
        const num = parseInt(val, 10);
        if (isNaN(num) || num < 1) {
            throw new Error('Revision 2 must be a positive integer');
        }
        return num;
    }),
});

export const bulkUpdateWithVersioningSchema = z.object({
    clusterName: z.string().min(1, 'Cluster name is required'),
    serviceName: z.string().min(1, 'Service name is required'),
    operations: z
        .array(
            z
                .object({
                    containerName: z.string().min(1, 'Container name is required'),
                    operation: z.enum(['add', 'edit', 'replace', 'remove'], {
                        errorMap: () => ({message: 'Operation must be one of: add, edit, replace, remove'}),
                    }),
                    environmentVariables: z.array(environmentVariableSchema),
                    variableNames: z.array(z.string().min(1, 'Variable name cannot be empty')).optional(),
                })
                .refine(
                    data => {
                        if (data.operation === 'remove') {
                            return data.variableNames && data.variableNames.length > 0;
                        } else {
                            return data.environmentVariables && data.environmentVariables.length > 0;
                        }
                    },
                    {
                        message:
                            'Environment variables are required for add/edit/replace operations, variable names are required for remove operation',
                    }
                )
        )
        .min(1, 'At least one operation is required'),
});
