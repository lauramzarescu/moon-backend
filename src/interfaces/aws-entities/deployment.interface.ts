import {DeploymentRolloutState} from "@aws-sdk/client-ecs/dist-types/models/models_0";

export interface DeploymentInterface {
    status: string
    desiredCount: number
    pendingCount: number
    runningCount: number
    createdAt: string
    updatedAt: string
    failedTasks: number
    rolloutState: DeploymentRolloutState
    rolloutStateReason: string
}

