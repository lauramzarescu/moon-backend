import {z} from 'zod';
import {
    addEnvironmentVariablesSchema,
    bulkUpdateWithVersioningSchema,
    compareVersionsSchema,
    copyVariablesBetweenServicesSchema,
    copyVariablesByServiceIdBodySchema,
    copyVariablesByServiceIdParamsSchema,
    editEnvironmentVariablesSchema,
    environmentVariableSchema,
    getVariablesFromVersionSchema,
    getVersionsListSchema,
    moveVariablesBetweenServicesSchema,
    moveVariablesByServiceIdBodySchema,
    removeEnvironmentVariablesSchema,
    replaceEnvironmentVariablesSchema,
    rollbackToVersionSchema,
    secretSchema,
} from '../../controllers/aws/environment-variable.schema';
import {BulkOperationType, ComparisonStatus} from '../../enums/environment-variable/environment-variable.enum';

// Base types
export type EnvironmentVariable = z.infer<typeof environmentVariableSchema>;
export type Secret = z.infer<typeof secretSchema>;

export type AddEnvironmentVariablesRequest = z.infer<typeof addEnvironmentVariablesSchema>;
export type EditEnvironmentVariablesRequest = z.infer<typeof editEnvironmentVariablesSchema>;
export type RemoveEnvironmentVariablesRequest = z.infer<typeof removeEnvironmentVariablesSchema>;
export type ReplaceEnvironmentVariablesRequest = z.infer<typeof replaceEnvironmentVariablesSchema>;

export type GetVersionsListRequest = z.infer<typeof getVersionsListSchema>;
export type GetVariablesFromVersionRequest = z.infer<typeof getVariablesFromVersionSchema>;
export type CopyVariablesBetweenServicesRequest = z.infer<typeof copyVariablesBetweenServicesSchema>;
export type CopyVariablesByServiceIdParamsRequest = z.infer<typeof copyVariablesByServiceIdParamsSchema>;
export type CopyVariablesByServiceIdBodyRequest = z.infer<typeof copyVariablesByServiceIdBodySchema>;
export type MoveVariablesBetweenServicesRequest = z.infer<typeof moveVariablesBetweenServicesSchema>;
export type MoveVariablesByServiceIdBodyRequest = z.infer<typeof moveVariablesByServiceIdBodySchema>;
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
    addedSecrets: number;
    newTaskDefinitionArn: string;
}

export interface EditEnvironmentVariablesResponse extends BaseEnvironmentVariableResponse {
    updatedVariables: number;
    updatedSecrets: number;
    newTaskDefinitionArn: string;
}

export interface RemoveEnvironmentVariablesResponse extends BaseEnvironmentVariableResponse {
    removedVariables: number;
    removedSecrets: number;
    variableNames: string[];
    secretNames: string[];
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
    pagination: {
        page: number;
        limit: number;
        totalPages: number;
        hasNextPage: boolean;
        hasPreviousPage: boolean;
    };
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
    copiedVariables?: {
        environmentVariables: number;
        secrets: number;
        variableNames?: string[];
    };
}

export interface MoveVariablesBetweenServicesResponse {
    message: string;
    source: ServiceInfo;
    target: ServiceInfo;
    newTaskDefinitionArn: string;
    movedVariables: {
        environmentVariables: number;
        secrets: number;
        variableNames: string[];
    };
}

export interface RollbackToVersionResponse extends BaseEnvironmentVariableResponse {
    targetRevision: number;
    newTaskDefinitionArn: string;
}

export interface VariableChange {
    name: string;
    oldValue: string;
    newValue: string;
    status: ComparisonStatus;
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

export interface BulkOperation {
    containerName: string;
    operation: BulkOperationType;
    environmentVariables: EnvironmentVariable[];
    variableNames?: string[];
    secrets: Secret[];
    secretNames?: string[];
}
