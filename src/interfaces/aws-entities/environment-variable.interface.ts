export interface EnvironmentVariable {
    name: string;
    value: string;
}

export interface EnvironmentVariableOperation {
    containerName: string;
    environmentVariables: EnvironmentVariable[];
}
