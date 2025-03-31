import {TaskDefinitionInterface} from './task-definition.interface';
import {DeploymentInterface} from './deployment.interface';
import {ContainerInterface} from './container.interface';

export interface ServiceInterface {
    name: string;
    clusterName: string;
    desiredCount: number;
    runningCount: number;
    pendingCount: number;
    status: 'ACTIVE' | 'INACTIVE' | 'DRAINING';
    taskDefinition: TaskDefinitionInterface;
    containers: ContainerInterface[];
    deployments: DeploymentInterface[];
    deploymentStatus?: {
        isStuck: boolean;
        stuckSince?: Date;
        elapsedTimeMs?: number;
        currentImages: {containerName: string; image: string}[];
        targetImages: {containerName: string; image: string}[];
    };
}
