import {AuthorizeSecurityGroupIngressCommand, DescribeInstancesCommand, EC2Client, Tag} from '@aws-sdk/client-ec2';
import {backoffAndRetry} from '../../utils/backoff.util';
import {InstanceInterface} from '../../interfaces/aws-entities/instance.interface';

export class EC2Service {
    private readonly ec2Client: EC2Client;

    constructor(ec2Client: EC2Client) {
        this.ec2Client = ec2Client;
    }

    public getInstances = async (): Promise<InstanceInterface[]> => {
        const instanceResponse = await backoffAndRetry(() => this.ec2Client.send(new DescribeInstancesCommand({})));

        return this.mapInstances(instanceResponse);
    };

    private mapInstances = (instanceResponse: any): InstanceInterface[] => {
        const reservations = instanceResponse.Reservations || [];
        const instances = reservations.flatMap((r: any) => r.Instances || []);

        return instances
            .filter((instance: any) => instance.State?.Name === 'running')
            .map((instance: any) => ({
                id: instance.InstanceId,
                name: instance.Tags.filter((tag: Tag) => tag.Key === 'Name')[0]?.Value || 'N/A',
                type: instance.InstanceType,
                state: instance.State?.Name,
                publicIp: instance.PublicIpAddress,
                primaryPrivateIp: instance.PrivateIpAddress,
                privateIpAddresses: instance.NetworkInterfaces?.flatMap(
                    (networkInterface: any) =>
                        networkInterface.PrivateIpAddresses?.map(
                            (privateIpAddress: any) => privateIpAddress.PrivateIpAddress
                        ) || []
                ),
            }));
    };

    /**
     * Adds an inbound rule to a security group for a specific client IP address.
     * @param securityGroupId The ID of the security group to modify.
     * @param clientIp The client's IP address.
     * @param fromPort
     * @param toPort
     * @param protocol The protocol (e.g., 'tcp', 'udp'). Defaults to 'tcp'.
     * @param description Optional description for the security group rule.
     */
    public addInboundRuleForClientIp = async (
        securityGroupId: string,
        clientIp: string,
        fromPort: number,
        toPort: number,
        protocol: string = 'tcp',
        description?: string
    ): Promise<void> => {
        const params = {
            GroupId: securityGroupId,
            IpPermissions: [
                {
                    IpProtocol: protocol,
                    FromPort: fromPort,
                    ToPort: toPort,
                    IpRanges: [
                        {
                            CidrIp: `${clientIp}/32`,
                            Description: description || `Allow access from ${clientIp} on port ${fromPort}-${toPort}`,
                        },
                    ],
                },
            ],
        };

        try {
            await backoffAndRetry(() => this.ec2Client.send(new AuthorizeSecurityGroupIngressCommand(params)));
            console.log(
                `Successfully added inbound rule for ${clientIp} to SG ${securityGroupId} on port ${fromPort}-${toPort}/${protocol}`
            );
        } catch (error) {
            console.error(`Error adding inbound rule for ${clientIp}:`, error);
            throw error;
        }
    };
}
