import {z} from 'zod';
import {
    addEnvironmentVariablesSchema,
    bulkUpdateEnvironmentVariablesSchema,
    bulkUpdateWithVersioningSchema,
    compareVersionsSchema,
    copyVariablesBetweenServicesSchema,
    editEnvironmentVariablesSchema,
    environmentVariableSchema,
    getVariablesFromVersionSchema,
    getVersionsListSchema,
    removeEnvironmentVariablesSchema,
    replaceEnvironmentVariablesSchema,
    rollbackToVersionSchema,
} from '../../controllers/aws/environment-variable.schema';

// Base types
export type EnvironmentVariable = z.infer<typeof environmentVariableSchema>;

// Request types (inferred from schemas)
export type AddEnvironmentVariablesRequest = z.infer<typeof addEnvironmentVariablesSchema>;
export type EditEnvironmentVariablesRequest = z.infer<typeof editEnvironmentVariablesSchema>;
export type RemoveEnvironmentVariablesRequest = z.infer<typeof removeEnvironmentVariablesSchema>;
export type ReplaceEnvironmentVariablesRequest = z.infer<typeof replaceEnvironmentVariablesSchema>;
export type BulkUpdateEnvironmentVariablesRequest = z.infer<typeof bulkUpdateEnvironmentVariablesSchema>;

// Versioning request types
export type GetVersionsListRequest = z.infer<typeof getVersionsListSchema>;
export type GetVariablesFromVersionRequest = z.infer<typeof getVariablesFromVersionSchema>;
export type CopyVariablesBetweenServicesRequest = z.infer<typeof copyVariablesBetweenServicesSchema>;
export type RollbackToVersionRequest = z.infer<typeof rollbackToVersionSchema>;
export type CompareVersionsRequest = z.infer<typeof compareVersionsSchema>;
export type BulkUpdateWithVersioningRequest = z.infer<typeof bulkUpdateWithVersioningSchema>;

// Response types
export interface BaseEnvironmentVariableResponse {
    message: string;
    clusterName: string;
    serviceName: string;
    containerName: string;
}

export interface AddEnvironmentVariablesResponse extends BaseEnvironmentVariableResponse {
    addedVariables: number;
    newTaskDefinitionArn: string;
}

export interface EditEnvironmentVariablesResponse extends BaseEnvironmentVariableResponse {
    updatedVariables: number;
    newTaskDefinitionArn: string;
}

export interface RemoveEnvironmentVariablesResponse extends BaseEnvironmentVariableResponse {
    removedVariables: number;
    variableNames: string[];
    newTaskDefinitionArn: string;
}

export interface ReplaceEnvironmentVariablesResponse extends BaseEnvironmentVariableResponse {
    totalVariables: number;
    newTaskDefinitionArn: string;
}

export interface BulkUpdateEnvironmentVariablesResponse {
    message: string;
    clusterName: string;
    serviceName: string;
    containersUpdated: number;
    totalVariables: number;
    newTaskDefinitionArn: string;
}

// Versioning response types
export interface EnvironmentVariableVersion {
    revision: number;
    arn: string;
    registeredAt: string;
    status: string;
    family: string;
    environmentVariables: EnvironmentVariable[];
}

export interface GetVersionsListResponse extends BaseEnvironmentVariableResponse {
    totalVersions: number;
    versions: EnvironmentVariableVersion[];
}

export interface GetVariablesFromVersionResponse extends BaseEnvironmentVariableResponse {
    revision: number;
    totalVariables: number;
    environmentVariables: EnvironmentVariable[];
}

export interface ServiceInfo {
    clusterName: string;
    serviceName: string;
    containerName: string;
    revision?: number;
}

export interface CopyVariablesBetweenServicesResponse {
    message: string;
    source: ServiceInfo;
    target: Omit<ServiceInfo, 'revision'>;
    newTaskDefinitionArn: string;
}

export interface RollbackToVersionResponse extends BaseEnvironmentVariableResponse {
    targetRevision: number;
    newTaskDefinitionArn: string;
}

export interface VariableChange {
    name: string;
    oldValue: string;
    newValue: string;
}

export interface VersionComparison {
    revision1: number;
    revision2: number;
    added: EnvironmentVariable[];
    removed: EnvironmentVariable[];
    modified: VariableChange[];
    unchanged: EnvironmentVariable[];
}

export interface CompareVersionsResponse extends BaseEnvironmentVariableResponse {
    comparison: VersionComparison;
}

export interface BulkUpdateWithVersioningResponse {
    message: string;
    clusterName: string;
    serviceName: string;
    containersUpdated: number;
    totalVariables: number;
    newTaskDefinitionArn: string;
}

// Error response type
export interface ErrorResponse {
    error: string;
    details: string;
}

// Operation types for bulk updates
export type BulkOperationType = 'add' | 'edit' | 'replace' | 'remove';

export interface BulkOperation {
    containerName: string;
    operation: BulkOperationType;
    environmentVariables: EnvironmentVariable[];
    variableNames?: string[];
}

// API endpoint definitions
export interface EnvironmentVariableEndpoints {
    // Existing endpoints
    addEnvironmentVariables: {
        method: 'POST';
        path: '/services/environment-variables';
        request: AddEnvironmentVariablesRequest;
        response: AddEnvironmentVariablesResponse;
    };

    editEnvironmentVariables: {
        method: 'PUT';
        path: '/services/environment-variables';
        request: EditEnvironmentVariablesRequest;
        response: EditEnvironmentVariablesResponse;
    };

    removeEnvironmentVariables: {
        method: 'DELETE';
        path: '/services/environment-variables';
        request: RemoveEnvironmentVariablesRequest;
        response: RemoveEnvironmentVariablesResponse;
    };

    replaceEnvironmentVariables: {
        method: 'PUT';
        path: '/services/environment-variables/replace';
        request: ReplaceEnvironmentVariablesRequest;
        response: ReplaceEnvironmentVariablesResponse;
    };

    bulkUpdateEnvironmentVariables: {
        method: 'PUT';
        path: '/services/environment-variables/bulk-update';
        request: BulkUpdateEnvironmentVariablesRequest;
        response: BulkUpdateEnvironmentVariablesResponse;
    };

    // Versioning endpoints
    getVersionsList: {
        method: 'GET';
        path: '/services/environment-variables/versions';
        request: GetVersionsListRequest;
        response: GetVersionsListResponse;
    };

    getVariablesFromVersion: {
        method: 'GET';
        path: '/services/environment-variables/version';
        request: GetVariablesFromVersionRequest;
        response: GetVariablesFromVersionResponse;
    };

    copyVariablesBetweenServices: {
        method: 'POST';
        path: '/services/environment-variables/copy';
        request: CopyVariablesBetweenServicesRequest;
        response: CopyVariablesBetweenServicesResponse;
    };

    rollbackToVersion: {
        method: 'POST';
        path: '/services/environment-variables/rollback';
        request: RollbackToVersionRequest;
        response: RollbackToVersionResponse;
    };

    compareVersions: {
        method: 'GET';
        path: '/services/environment-variables/compare';
        request: CompareVersionsRequest;
        response: CompareVersionsResponse;
    };

    bulkUpdateWithVersioning: {
        method: 'PUT';
        path: '/services/environment-variables/bulk-update-versioning';
        request: BulkUpdateWithVersioningRequest;
        response: BulkUpdateWithVersioningResponse;
    };
}

// Type guards for runtime type checking
export const isErrorResponse = (response: any): response is ErrorResponse => {
    return response && typeof response.error === 'string' && typeof response.details === 'string';
};

export const isEnvironmentVariable = (obj: any): obj is EnvironmentVariable => {
    return obj && typeof obj.name === 'string' && typeof obj.value === 'string';
};

export const isEnvironmentVariableVersion = (obj: any): obj is EnvironmentVariableVersion => {
    return (
        obj &&
        typeof obj.revision === 'number' &&
        typeof obj.arn === 'string' &&
        typeof obj.registeredAt === 'string' &&
        typeof obj.status === 'string' &&
        typeof obj.family === 'string' &&
        Array.isArray(obj.environmentVariables)
    );
};
