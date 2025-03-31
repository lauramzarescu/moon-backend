import {
    DescribeClustersCommand,
    DescribeServicesCommand,
    DescribeServicesCommandOutput,
    DescribeTaskDefinitionCommand,
    ECSClient,
    ListClustersCommand,
    ListServicesCommand
} from "@aws-sdk/client-ecs";
import {mockClient} from "aws-sdk-client-mock";
import {
    EXPECTED_CLUSTER_INTERFACE,
    EXPECTED_SERVICE_INTERFACE,
    MOCK_CLUSTER_NAME,
    MOCK_DESCRIBE_CLUSTERS_RESPONSE,
    MOCK_LIST_CLUSTERS_RESPONSE,
    MOCK_LIST_SERVICES_RESPONSE,
    MOCK_SCHEDULED_TASKS,
    MOCK_SERVICE_DETAILS,
    MOCK_TASK_DEFINITION_RESPONSE
} from "./constants/ecs-service.constants";
import {ECSService} from "../services/aws/ecs.service";
import {Deployment} from "@aws-sdk/client-ecs/dist-types/models";

// Mock the backoffAndRetry utility
jest.mock('../utils/backoff.util', () => ({
    backoffAndRetry: jest.fn((fn) => fn())
}));

// Mock the SchedulerService and DeploymentMonitorService
jest.mock('../services/aws/scheduler.service', () => ({
    SchedulerService: jest.fn().mockImplementation(() => ({
        getECSScheduledTasks: jest.fn().mockResolvedValue(MOCK_SCHEDULED_TASKS)
    }))
}));

jest.mock('../services/aws/deployment-monitor.service', () => ({
    DeploymentMonitorService: jest.fn().mockImplementation(() => ({
        isDeploymentStuck: jest.fn().mockResolvedValue({isStuck: false}),
        getTasksInfo: jest.fn().mockResolvedValue([])
    }))
}));

describe('ECSService', () => {
    const ecsMock = mockClient(ECSClient);
    let ecsService: ECSService;

    beforeEach(() => {
        ecsMock.reset();
        // Create a new instance of ECSService with the mocked client
        ecsService = new ECSService(new ECSClient({}));
    });

    describe('getClusterServices', () => {
        it('should return an empty array when no services are found', async () => {
            // Mock the ListServicesCommand to return no services
            ecsMock.on(ListServicesCommand).resolves({serviceArns: []});

            const result = await ecsService.getClusterServices(MOCK_CLUSTER_NAME);

            expect(result).toEqual([]);
            expect(ecsMock.calls()).toHaveLength(1);
        });

        it('should return services with their details', async () => {
            // Mock the necessary AWS commands
            ecsMock.on(ListServicesCommand).resolves(MOCK_LIST_SERVICES_RESPONSE);
            ecsMock.on(DescribeServicesCommand).resolves(MOCK_SERVICE_DETAILS);
            ecsMock.on(DescribeTaskDefinitionCommand).resolves(MOCK_TASK_DEFINITION_RESPONSE);

            const result = await ecsService.getClusterServices(MOCK_CLUSTER_NAME);

            // Verify the result contains the expected service data
            expect(result).toHaveLength(2);
            expect(result[0]).toEqual(EXPECTED_SERVICE_INTERFACE);

            // Verify the AWS commands were called with the correct parameters
            const listServicesCalls = ecsMock.commandCalls(ListServicesCommand);
            expect(listServicesCalls).toHaveLength(1);
            expect(listServicesCalls[0].args[0].input).toEqual({cluster: MOCK_CLUSTER_NAME});

            const describeServicesCalls = ecsMock.commandCalls(DescribeServicesCommand);
            expect(describeServicesCalls).toHaveLength(1);
            expect(describeServicesCalls[0].args[0].input).toEqual({
                cluster: MOCK_CLUSTER_NAME,
                services: ['test-service-1', 'test-service-2']
            });
        });

        it('should check for stuck deployments when specified', async () => {
            // Mock the necessary AWS commands
            ecsMock.on(ListServicesCommand).resolves(MOCK_LIST_SERVICES_RESPONSE);

            // Create a service with multiple deployments to trigger stuck deployment check
            const serviceWithMultipleDeployments: DescribeServicesCommandOutput = {
                $metadata: {},
                services: [
                    {
                        ...MOCK_SERVICE_DETAILS.services?.[0],
                        deployments: [
                            MOCK_SERVICE_DETAILS.services?.[0]?.deployments?.[0],
                            {...MOCK_SERVICE_DETAILS.services?.[0]?.deployments?.[0], status: 'ACTIVE'}
                        ].filter((deployment): deployment is Deployment => deployment !== undefined)
                    }
                ]
            };

            ecsMock.on(DescribeServicesCommand).resolves(serviceWithMultipleDeployments);
            ecsMock.on(DescribeTaskDefinitionCommand).resolves(MOCK_TASK_DEFINITION_RESPONSE);

            // Mock the deployment monitor to report a stuck deployment
            const mockDeploymentMonitorService = require('../services/aws/deployment-monitor.service').DeploymentMonitorService;
            mockDeploymentMonitorService.mockImplementation(() => ({
                isDeploymentStuck: jest.fn().mockResolvedValue({
                    isStuck: true,
                    details: {
                        startTime: new Date(),
                        elapsedTimeMs: 3600000,
                        currentImages: ['nginx:1.19'],
                        targetImages: ['nginx:1.20']
                    }
                }),
                getTasksInfo: jest.fn().mockResolvedValue([])
            }));

            const result = await ecsService.getClusterServices(MOCK_CLUSTER_NAME, true);

            // Verify the result contains the stuck deployment information
            expect(result).toHaveLength(1);
            expect(result[0].deploymentStatus).toBeDefined();
            expect(result[0].deploymentStatus?.isStuck).toBe(true);
            expect(result[0].deploymentStatus?.currentImages).toEqual(['nginx:1.19']);
            expect(result[0].deploymentStatus?.targetImages).toEqual(['nginx:1.20']);
        });

        it('should throw an error when task definition is not found', async () => {
            // Mock the necessary AWS commands
            ecsMock.on(ListServicesCommand).resolves(MOCK_LIST_SERVICES_RESPONSE);

            // Create a service without a task definition
            const serviceWithoutTaskDef: DescribeServicesCommandOutput = {
                services: [
                    {
                        ...MOCK_SERVICE_DETAILS.services?.[0],
                        taskDefinition: undefined
                    }
                ],
                $metadata: {}
            };

            ecsMock.on(DescribeServicesCommand).resolves(serviceWithoutTaskDef);

            await expect(ecsService.getClusterServices(MOCK_CLUSTER_NAME))
                .rejects.toThrow('Task definition not found');
        });
    });

    describe('getClusterDetails', () => {
        it('should return cluster details with services and scheduled tasks', async () => {
            // Mock the necessary AWS commands
            ecsMock.on(ListClustersCommand).resolves(MOCK_LIST_CLUSTERS_RESPONSE);
            ecsMock.on(DescribeClustersCommand).resolves(MOCK_DESCRIBE_CLUSTERS_RESPONSE);

            // Mock getClusterServices to return the expected service interface
            jest.spyOn(ecsService, 'getClusterServices').mockResolvedValue([EXPECTED_SERVICE_INTERFACE]);

            const result = await ecsService.getClusterDetails([]);

            // Verify the result contains the expected cluster data
            expect(result).toHaveLength(2);
            expect(result[0]).toEqual(EXPECTED_CLUSTER_INTERFACE);

            // Verify the AWS commands were called with the correct parameters
            const listClustersCalls = ecsMock.commandCalls(ListClustersCommand);
            expect(listClustersCalls).toHaveLength(1);

            const describeClustersCalls = ecsMock.commandCalls(DescribeClustersCommand);
            expect(describeClustersCalls).toHaveLength(1);
            expect(describeClustersCalls[0].args[0].input).toEqual({
                clusters: MOCK_LIST_CLUSTERS_RESPONSE.clusterArns
            });
        });

        it('should skip clusters without a name or ARN', async () => {
            // Mock the necessary AWS commands
            ecsMock.on(ListClustersCommand).resolves(MOCK_LIST_CLUSTERS_RESPONSE);

            // Create a cluster response with an invalid cluster
            const clustersWithInvalidCluster = {
                clusters: [
                    {...MOCK_DESCRIBE_CLUSTERS_RESPONSE.clusters[0]},
                    {status: 'ACTIVE'} // Missing clusterName and clusterArn
                ]
            };

            ecsMock.on(DescribeClustersCommand).resolves(clustersWithInvalidCluster);

            // Mock getClusterServices to return the expected service interface
            jest.spyOn(ecsService, 'getClusterServices').mockResolvedValue([EXPECTED_SERVICE_INTERFACE]);

            // Mock console.log to prevent output during test
            const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

            const result = await ecsService.getClusterDetails([]);

            // Verify only one valid cluster was processed
            expect(result).toHaveLength(1);
            expect(consoleSpy).toHaveBeenCalledWith('Cluster does not exist');

            consoleSpy.mockRestore();
        });

        it('should handle empty cluster list', async () => {
            // Mock the necessary AWS commands
            ecsMock.on(ListClustersCommand).resolves({clusterArns: []});
            ecsMock.on(DescribeClustersCommand).resolves({clusters: []});

            const result = await ecsService.getClusterDetails([]);

            // Verify an empty array is returned
            expect(result).toEqual([]);
        });
    });
});