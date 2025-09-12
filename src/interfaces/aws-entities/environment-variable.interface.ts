export interface EnvironmentVariable {
    name: string;
    value: string;
}

export interface Secret {
    name: string;
    valueFrom: string;
}

export interface EnvironmentVariableOperation {
    containerName: string;
    environmentVariables: EnvironmentVariable[];
}
