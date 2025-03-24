import {DescribeInstancesCommand, EC2Client} from '@aws-sdk/client-ec2';
import {backoffAndRetry} from '../../utils/backoff.util';
import {InstanceInterface} from "../../interfaces/aws-entities/instance.interface";

export class EC2Service {
    private readonly ec2Client: EC2Client;

    constructor(ec2Client: EC2Client) {
        this.ec2Client = ec2Client;
    }

    public getInstances = async (): Promise<InstanceInterface[]> => {
        const instanceResponse = await backoffAndRetry(() =>
            this.ec2Client.send(new DescribeInstancesCommand({}))
        );

        return this.mapInstances(instanceResponse);
    }

    private mapInstances = (instanceResponse: any): InstanceInterface[] => {
        const reservations = instanceResponse.Reservations || [];
        const instances = reservations.flatMap((r: any) => r.Instances || []);

        return instances
            .filter((instance: any) => instance.State?.Name === 'running')
            .map((instance: any) => ({
                id: instance.InstanceId,
                type: instance.InstanceType,
                state: instance.State?.Name,
                publicIp: instance.PublicIpAddress,
                privateIp: instance.PrivateIpAddress,
            }));
    }
}
