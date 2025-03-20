import {ServiceInterface} from "./service.interface";
import {ScheduledTaskInterface} from "./scheduled-task.interface";

export interface ClusterInterface {
    name: string
    arn: string
    status: 'ACTIVE' | 'INACTIVE' | 'FAILED' | 'PROVISIONING' | 'DEPROVISIONING'
    runningTasks: number
    pendingTasks: number
    registeredContainerInstances: number
    servicesCount: number
    services: ServiceInterface[]
    scheduledTasks: ScheduledTaskInterface[]
}
