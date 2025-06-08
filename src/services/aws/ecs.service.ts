import {ECSClient} from '@aws-sdk/client-ecs';
import {ClusterInterface} from '../../interfaces/aws-entities/cluster.interface';
import {ServiceInterface} from '../../interfaces/aws-entities/service.interface';
import {ScheduledTaskInterface} from '../../interfaces/aws-entities/scheduled-task.interface';
import {
    EnvironmentVariable,
    EnvironmentVariableOperation,
} from '../../interfaces/aws-entities/environment-variable.interface';
import {ClusterManagementService} from './cluster-management.service';
import {ServiceManagementService} from './service-management.service';
import {DeploymentMonitorService} from './deployment-monitor.service';
import {EnvironmentVariableService} from './environment-variable.service';
import logger from '../../config/logger';

export class ECSService {
    private readonly ecsClient: ECSClient;
    private readonly clusterManagementService: ClusterManagementService;
    private readonly serviceManagementService: ServiceManagementService;
    private readonly deploymentMonitorService: DeploymentMonitorService;
    private readonly environmentVariableService: EnvironmentVariableService;

    constructor(ecsClient: ECSClient) {
        this.ecsClient = ecsClient;
        this.clusterManagementService = new ClusterManagementService(ecsClient);
        this.serviceManagementService = new ServiceManagementService(ecsClient);
        this.deploymentMonitorService = new DeploymentMonitorService(ecsClient);
        this.environmentVariableService = new EnvironmentVariableService(ecsClient);
    }

    /**
     * Retrieve basic cluster details without services and scheduled tasks.
     */
    public getBasicClusterDetails = async (): Promise<ClusterInterface[]> => {
        return await this.clusterManagementService.getBasicClusterDetails();
    };

    /**
     * Get services for a specific cluster
     */
    public getClusterServicesOnly = async (clusterName: string): Promise<ServiceInterface[]> => {
        logger.info(`[ECS] Fetching services for cluster: ${clusterName}`);
        return await this.serviceManagementService.getClusterServices(clusterName, true);
    };

    /**
     * Get scheduled tasks for a specific cluster
     */
    public getClusterScheduledTasksOnly = async (
        clusterArn: string,
        clusterName: string
    ): Promise<ScheduledTaskInterface[]> => {
        return await this.clusterManagementService.getClusterScheduledTasksOnly(clusterArn, clusterName);
    };

    /**
     * Check for stuck deployment
     */
    public checkForStuckDeployment = async (clusterName: string, serviceName: string) => {
        return await this.deploymentMonitorService.isDeploymentStuck(clusterName, serviceName);
    };

    /**
     * Get cluster services with optional stuck deployment checking
     */
    public getClusterServices = async (
        clusterName: string,
        checkStuckDeployments = true
    ): Promise<ServiceInterface[]> => {
        return await this.serviceManagementService.getClusterServices(clusterName, checkStuckDeployments);
    };

    /**
     * Get full cluster details with services and scheduled tasks
     */
    public getClusterDetails = async (instances: any[]): Promise<ClusterInterface[]> => {
        return await this.clusterManagementService.getClusterDetails(instances);
    };

    /**
     * Update service desired count
     */
    public updateServiceDesiredCount = async (
        clusterName: string,
        serviceName: string,
        desiredCount: number
    ): Promise<void> => {
        return await this.serviceManagementService.updateServiceDesiredCount(clusterName, serviceName, desiredCount);
    };

    /**
     * Update service container image
     */
    public updateServiceContainerImage = async (
        clusterName: string,
        serviceName: string,
        containerName: string,
        newImageUri: string
    ): Promise<string> => {
        return await this.serviceManagementService.updateServiceContainerImage(
            clusterName,
            serviceName,
            containerName,
            newImageUri
        );
    };

    /**
     * Restart service
     */
    public restartService = async (clusterName: string, serviceName: string): Promise<void> => {
        return await this.serviceManagementService.restartService(clusterName, serviceName);
    };

    // Environment Variable Management Methods

    /**
     * Get environment variables for a service container
     */
    public getServiceEnvironmentVariables = async (
        clusterName: string,
        serviceName: string,
        containerName: string
    ): Promise<EnvironmentVariable[]> => {
        return await this.environmentVariableService.getServiceEnvironmentVariables(
            clusterName,
            serviceName,
            containerName
        );
    };

    /**
     * Add environment variables to a service container
     */
    public addEnvironmentVariables = async (
        clusterName: string,
        serviceName: string,
        containerName: string,
        environmentVariables: EnvironmentVariable[]
    ): Promise<string> => {
        return await this.environmentVariableService.addEnvironmentVariables(
            clusterName,
            serviceName,
            containerName,
            environmentVariables
        );
    };

    /**
     * Edit existing environment variables in a service container
     */
    public editEnvironmentVariables = async (
        clusterName: string,
        serviceName: string,
        containerName: string,
        environmentVariables: EnvironmentVariable[]
    ): Promise<string> => {
        return await this.environmentVariableService.editEnvironmentVariables(
            clusterName,
            serviceName,
            containerName,
            environmentVariables
        );
    };

    /**
     * Remove environment variables from a service container
     */
    public removeEnvironmentVariables = async (
        clusterName: string,
        serviceName: string,
        containerName: string,
        variableNames: string[]
    ),: Promise<string> => {
        return await this.environmentVariableService.removeEnvironmentVariables(
            clusterName,
            serviceName,
            containerName,
            variableNames
     ,   );
    };

    /**
     * Replace all environment variables for a service container
     */
    public replaceAllEnvironmentVariables = async (
        clusterName: string,
        serviceName: string,
        containerName: string,
        environmentVariables: EnvironmentVariable[],
    ): Promise<string> => {
        return await this.environmentVariableService.replaceAllEnvironmentVariables(
            clusterName,
            serviceName,
            containerName,
            environmentVariables,
        );
    };

    /**
     * Bulk update environment variables for multiple containers in a service
     */
    public bulkUpdateEnvironmentVariables = async (
        clusterName: string,
        serviceName: string,
        operations: EnvironmentVariableOperation[],
    ): Promise<string> => {
        return await this.environmentVariableService.bulkUpdateEnvironmentVariables(
            clusterName,
            serviceName,
            operations,
        );
    };
}
