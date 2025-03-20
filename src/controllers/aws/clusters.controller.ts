import {Request, Response} from 'express';
import {EC2Service} from '../../services/aws/ec2.service';
import {ECSService} from '../../services/aws/ecs.service';
import {ec2Client, ecsClient} from '../../config/aws.config';
import {ClusterResponse} from "../../interfaces/responses/cluster-response.interface";

export class ClustersController {
    private readonly ec2Service: EC2Service;
    private readonly ecsService: ECSService;

    constructor() {
        this.ec2Service = new EC2Service(ec2Client);
        this.ecsService = new ECSService(ecsClient);
    }

    public getClusters = async (req: Request, res: Response) => {
        try {
            const instances = await this.ec2Service.getInstances();
            const response: ClusterResponse = {
                clusters: {
                    clusters: await this.ecsService.getClusterDetails(instances),
                },
                ec2Instances: {
                    instances: instances,
                },
                updatedOn: new Date().toISOString()
            };

            res.json(response);
        } catch (error) {
            const errorResponse = {
                error: 'Failed to fetch cluster information',
                details: error
            };
            res.status(500).json(errorResponse);
        }
    }
}
