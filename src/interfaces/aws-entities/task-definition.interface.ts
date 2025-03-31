import {TaskDefinitionStatus} from '@aws-sdk/client-ecs/dist-types/models/models_0';

export interface TaskDefinitionInterface {
    family: string;
    revision: number;
    arn: string;
    name: string;
    registeredAt: string;
    status: TaskDefinitionStatus;
    cpu: string;
    memory: string;
}
