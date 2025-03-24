import {Request, Response} from 'express';
import {ECSService} from '../../services/aws/ecs.service';
import {ecsClient} from '../../config/aws.config';
import {serviceUpdateCountSchema, serviceUpdateImageSchema} from "./service.schema";

export class ServicesController {
    private readonly ecsService: ECSService;

    constructor() {
        this.ecsService = new ECSService(ecsClient);
    }

    public updateServiceDesiredCount = async (req: Request, res: Response) => {
        try {
            const {clusterName, serviceName, desiredCount} = serviceUpdateCountSchema.parse(req.body);

            await this.ecsService.updateServiceDesiredCount(
                clusterName,
                serviceName,
                desiredCount
            );

            res.json({
                message: 'Service desired count updated successfully',
                clusterName,
                serviceName,
                desiredCount
            });
        } catch (error) {
            const errorResponse = {
                error: 'Failed to update service desired count',
                details: error
            };
            res.status(500).json(errorResponse);
        }
    }

    public updateServiceContainerImage = async (req: Request, res: Response) => {
        try {
            const {
                clusterName,
                serviceName,
                containerName,
                newImageUri
            } = serviceUpdateImageSchema.parse(req.body);

            const newTaskDefinitionArn = await this.ecsService.updateServiceContainerImage(
                clusterName,
                serviceName,
                containerName,
                newImageUri
            );
            
            res.json({
                message: 'Service container image updated successfully',
                clusterName,
                serviceName,
                containerName,
                newImageUri,
                newTaskDefinitionArn
            });
        } catch
            (error) {
            const errorResponse = {
                error: 'Failed to update service container image',
                details: error
            };
            res.status(500).json(errorResponse);
        }
    }
}
