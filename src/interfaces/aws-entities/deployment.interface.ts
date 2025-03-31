import {DeploymentRolloutState} from "@aws-sdk/client-ecs/dist-types/models/models_0";

export interface DeploymentInterface {
    status: string
    desiredCount: number
    pendingCount: number
    runningCount: number
    createdAt: Date
    updatedAt: Date
    failedTasks: number
    rolloutState: DeploymentRolloutState
    rolloutStateReason: string
}

