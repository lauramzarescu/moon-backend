import {ServiceInterface} from "../../interfaces/aws-entities/service.interface";
import {ClusterInterface} from "../../interfaces/aws-entities/cluster.interface";
import {ScheduledTaskInterface} from "../../interfaces/aws-entities/scheduled-task.interface";
import {ContainerInterface} from "../../interfaces/aws-entities/container.interface";
import {TaskDefinitionInterface} from "../../interfaces/aws-entities/task-definition.interface";
import {DeploymentInterface} from "../../interfaces/aws-entities/deployment.interface";
import {InstanceInterface} from "../../interfaces/aws-entities/instance.interface";
import {DescribeServicesCommandOutput, DescribeTaskDefinitionCommandOutput} from "@aws-sdk/client-ecs";

export const MOCK_CLUSTER_NAME: string = 'test-cluster';
export const MOCK_SERVICE_NAME: string = 'test-service';
export const MOCK_CONTAINER_NAME: string = 'test-container';
export const MOCK_IMAGE_URI: string = 'nginx:latest';
export const MOCK_TASK_DEFINITION_ARN: string = 'arn:aws:ecs:us-east-1:123456789012:task-definition/test-task:1';

export const MOCK_LIST_SERVICES_RESPONSE: { serviceArns: string[] } = {
    serviceArns: [
        'arn:aws:ecs:us-east-1:123456789012:service/test-cluster/test-service-1',
        'arn:aws:ecs:us-east-1:123456789012:service/test-cluster/test-service-2'
    ]
};

export const MOCK_SCHEDULED_TASKS: ScheduledTaskInterface[] = [
    {
        name: 'scheduled-task-1',
        cron: 'cron(0 12 * * ? *)',
        command: 'echo "Hello World"',
        status: 'ENABLED',
        eventBusName: 'default',
        arn: 'arn:aws:events:us-east-1:123456789012:rule/scheduled-task-1',
        readableCron: 'At 12:00 PM UTC every day',
        nextRun: new Date(Date.now() + 86400000).toISOString(),
        nextRuns: [
            new Date(Date.now() + 86400000).toISOString(),
            new Date(Date.now() + 172800000).toISOString()
        ],
        clusterName: 'test-cluster-1'
    }
];

export const MOCK_CONTAINER: ContainerInterface = {
    name: 'test-container',
    image: 'nginx:latest',
    cpu: 256,
    memory: 512, // Change from string to number
    environmentVariables: {
        environment: [], // Change to match the expected empty array
        environmentFiles: [],
        secrets: [] // Change to match the expected empty array
    }
};

export const MOCK_TASK_DEFINITION: TaskDefinitionInterface = {
    family: 'test-task',
    revision: 1,
    arn: 'arn:aws:ecs:us-east-1:123456789012:task-definition/test-task:1',
    name: 'arn:aws:ecs:us-east-1:123456789012:task-definition/test-task:1',
    registeredAt: new Date().toISOString(),
    status: 'ACTIVE',
    cpu: '256',
    memory: '512',
};

export const MOCK_DEPLOYMENT: DeploymentInterface = {
    status: 'PRIMARY',
    desiredCount: 2,
    pendingCount: 0,
    runningCount: 2,
    createdAt: new Date(),
    updatedAt: new Date(),
    failedTasks: 0,
    rolloutState: 'COMPLETED',
    rolloutStateReason: '',
};

export const MOCK_INSTANCE: InstanceInterface = {
    id: 'i-1234567890abcdef0',
    type: 't3.medium',
    state: 'running',
    publicIp: '54.123.45.67',
    privateIp: '10.0.1.23',
    services: []
};

export const EXPECTED_SERVICE_INTERFACE: ServiceInterface = {
    name: 'test-service-1', // Ensure this matches the mock data
    clusterName: 'test-cluster',
    desiredCount: 2,
    runningCount: 2,
    pendingCount: 0,
    status: 'ACTIVE',
    taskDefinition: {
        family: 'test-task',
        revision: 1,
        arn: 'arn:aws:ecs:us-east-1:123456789012:task-definition/test-task:1',
        name: 'arn:aws:ecs:us-east-1:123456789012:task-definition/test-task:1',
        registeredAt: new Date().toISOString(),
        status: 'ACTIVE',
        cpu: '256',
        memory: '512',
    },
    containers: [MOCK_CONTAINER],
    deployments: [MOCK_DEPLOYMENT],
    deploymentStatus: undefined
};

export const EXPECTED_CLUSTER_INTERFACE: ClusterInterface = {
    name: 'test-cluster-1',
    arn: 'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster-1',
    status: 'ACTIVE',
    runningTasks: 3,
    pendingTasks: 0,
    registeredContainerInstances: 2,
    servicesCount: 2,
    services: [EXPECTED_SERVICE_INTERFACE],
    scheduledTasks: MOCK_SCHEDULED_TASKS,
};

export const MOCK_SERVICE_DETAILS: DescribeServicesCommandOutput = {
    $metadata: {},
    services: [
        {
            ...EXPECTED_SERVICE_INTERFACE,
            name: 'test-service-1', // Ensure this matches the expected data
            taskDefinition: 'arn:aws:ecs:us-east-1:123456789012:task-definition/test-task:1',
            deployments: [
                {
                    ...MOCK_DEPLOYMENT,
                    createdAt: new Date(),
                    updatedAt: new Date()
                }
            ]
        },
        {
            ...EXPECTED_SERVICE_INTERFACE,
            name: 'test-service-2',
            taskDefinition: 'arn:aws:ecs:us-east-1:123456789012:task-definition/test-task:2',
            deployments: [
                {
                    ...MOCK_DEPLOYMENT,
                    desiredCount: 1,
                    runningCount: 1,
                    createdAt: new Date(),
                    updatedAt: new Date()
                }
            ]
        }
    ]
}

export const MOCK_TASK_DEFINITION_RESPONSE: DescribeTaskDefinitionCommandOutput = {
    $metadata: {},
    taskDefinition: {
        ...MOCK_TASK_DEFINITION,
        registeredAt: new Date(),
        containerDefinitions: [
            {
                ...MOCK_CONTAINER,
                memory: 512
            }
        ]
    }
};

export const MOCK_LIST_CLUSTERS_RESPONSE: { clusterArns: string[] } = {
    clusterArns: [
        'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster-1',
        'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster-2'
    ]
};

export const MOCK_DESCRIBE_CLUSTERS_RESPONSE: { clusters: ClusterInterface[] } = {
    clusters: [
        {
            name: 'test-cluster-1',
            arn: 'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster-1',
            status: 'ACTIVE',
            runningTasks: 3,
            pendingTasks: 0,
            registeredContainerInstances: 2,
            servicesCount: 2,
            services: [],
            scheduledTasks: []
        },
        {
            name: 'test-cluster-2',
            arn: 'arn:aws:ecs:us-east-1:123456789012:cluster/test-cluster-2',
            status: 'ACTIVE',
            runningTasks: 1,
            pendingTasks: 0,
            registeredContainerInstances: 1,
            servicesCount: 1,
            services: [],
            scheduledTasks: []
        }
    ]
};