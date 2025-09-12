import {TaskDefinitionInterface} from './task-definition.interface';
import {DeploymentInterface} from './deployment.interface';
import {ContainerInterface} from './container.interface';
import {Task} from '@aws-sdk/client-ecs';

export interface ServiceInterface {
    name: string;
    arn: string;
    clusterName: string;
    isClusterProduction: boolean;
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
    failedTasks?: Task[];
}
