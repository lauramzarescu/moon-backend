import {ClusterInterface} from '../interfaces/aws-entities/cluster.interface';
import {ServiceInterface} from '../interfaces/aws-entities/service.interface';
import {ScheduledTaskInterface} from '../interfaces/aws-entities/scheduled-task.interface';

const generateScheduledTask = (index: number): ScheduledTaskInterface => ({
    name: `scheduled-task-${index}`,
    cron: `0 ${Math.floor(Math.random() * 24)} * * *`,
    command: `run-backup-${index}`,
    status: ['ENABLED', 'DISABLED'][Math.floor(Math.random() * 2)] as 'ENABLED' | 'DISABLED',
    eventBusName: `default-event-bus-${index}`,
    arn: `arn:aws:events:us-east-1:123456789:rule/scheduled-task-${index}`,
    readableCron: `At ${Math.floor(Math.random() * 24)}:00 every day`,
    nextRun: new Date(Date.now() + Math.floor(Math.random() * 86400000)).toISOString(),
    nextRuns: Array.from({length: 10}, (_, i) => new Date(Date.now() + (i + 1) * 86400000).toISOString()),
    clusterName: `cluster-${index}`,
});

const generateService = (index: number): ServiceInterface => ({
    name: `service-${index}`,
    clusterName: `cluster-${index}`,
    desiredCount: Math.floor(Math.random() * 5) + 1,
    runningCount: Math.floor(Math.random() * 5) + 1,
    pendingCount: Math.floor(Math.random() * 2),
    status: ['ACTIVE', 'DRAINING', 'INACTIVE'][Math.floor(Math.random() * 2)] as 'ACTIVE' | 'DRAINING' | 'INACTIVE',
    taskDefinition: {
        family: `family-${index}`,
        revision: Math.floor(Math.random() * 10) + 1,
        arn: `arn:aws:ecs:us-east-1:123456789:task-definition/family-${index}`,
        name: `task-${index}`,
        registeredAt: new Date().toISOString(),
        status: 'ACTIVE',
        cpu: String(256 * (Math.floor(Math.random() * 4) + 1)),
        memory: String(512 * (Math.floor(Math.random() * 4) + 1)),
    },
    containers: [
        {
            image: `nginx:${Math.random()
                .toString(36)
                .substring(2)
                .padEnd(25, 'x')
                .substring(0, Math.floor(Math.random() * (100 - 70) + 70))}`,
            cpu: 256,
            memory: '512',
            name: `container-${index}`,
            environmentVariables: {
                environment: [
                    {name: 'ENV', value: 'production'},
                    {name: 'PORT', value: String(3000 + index)},
                ],
                environmentFiles: [],
                secrets: [],
            },
        },
    ],
    deployments: [
        {
            status: 'PRIMARY',
            desiredCount: 2,
            pendingCount: 0,
            runningCount: 2,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            failedTasks: 0,
            rolloutState: 'COMPLETED',
            rolloutStateReason: 'ECS deployment completed successfully',
        },
    ],
});

export const mockClusters: ClusterInterface[] = Array.from({length: 20}, (_, i) => ({
    name: `cluster-${i}`,
    arn: `arn:aws:ecs:us-east-1:123456789:cluster/cluster-${i}`,
    status: ['ACTIVE', 'PROVISIONING', 'INACTIVE', 'DEPROVISIONING', 'FAILED'][
        Math.floor(Math.random() * 5)
    ] as ClusterInterface['status'],
    runningTasks: Math.floor(Math.random() * 10),
    pendingTasks: Math.floor(Math.random() * 3),
    registeredContainerInstances: Math.floor(Math.random() * 5) + 1,
    servicesCount: Math.floor(Math.random() * 5) + 1,
    services: Array.from({length: Math.floor(Math.random() * 3) + 1}, (_, index) => generateService(i * 100 + index)),
    scheduledTasks: Array.from({length: Math.floor(Math.random() * 3) + 1}, (_, index) =>
        generateScheduledTask(i * 100 + index)
    ),
}));
