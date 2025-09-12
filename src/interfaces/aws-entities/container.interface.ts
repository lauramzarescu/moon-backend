import {EnvironmentVariable, Secret} from './environment-variable.interface';

export interface ContainerInterface {
    image: string;
    cpu: number;
    memory: string;
    name: string;
    environmentVariables: {
        environment: EnvironmentVariable[];
        environmentFiles: any[];
        secrets: Secret[];
    };
}
