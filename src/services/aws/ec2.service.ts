import {
    AuthorizeSecurityGroupIngressCommand,
    DescribeInstancesCommand,
    DescribeSecurityGroupsCommand,
    EC2Client,
    RevokeSecurityGroupIngressCommand,
    Tag,
} from '@aws-sdk/client-ec2';
import {backoffAndRetry} from '../../utils/backoff.util';
import {InstanceInterface} from '../../interfaces/aws-entities/instance.interface';
import {RemoveAllInboundRulesConfig, RemoveInboundRuleConfig} from '../../controllers/action/action.schema';
import {RulesHelper} from '../../utils/rules-helper';

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
                            CidrIp: `${clientIp}`,
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

    /**
     * Removes a specific inbound rule from a security group for a client IP address.
     * The rule properties (protocol, ports, CIDR) must match exactly.
     * @param config
     */
    public removeInboundRuleForClientIp = async (config: RemoveInboundRuleConfig): Promise<void> => {
        const {securityGroupId, ip: clientIp, protocol} = config;
        const {fromPort, toPort} = RulesHelper.parsePortRange(config.portRange);
        const ipCidr = RulesHelper.ensureCidrFormat(config.ip || '-');

        const params = {
            GroupId: securityGroupId,
            IpPermissions: [
                {
                    IpProtocol: protocol,
                    FromPort: fromPort,
                    ToPort: toPort,
                    IpRanges: [
                        {
                            CidrIp: `${ipCidr}`,
                            // Note: Description is not required for revoke, and if provided, must match exactly.
                        },
                    ],
                    // UserIdGroupPairs: [],
                    // Ipv6Ranges: [],
                    // PrefixListIds: []
                },
            ],
        };

        try {
            // Use RevokeSecurityGroupIngressCommand
            await backoffAndRetry(() => this.ec2Client.send(new RevokeSecurityGroupIngressCommand(params)));
            console.log(`Successfully revoked inbound rule for ${clientIp} from SG ${securityGroupId}`);
        } catch (error: any) {
            // For non-default VPCs, a non-matching rule throws InvalidPermission.NotFound
            if (error.name === 'InvalidPermission.NotFound') {
                console.warn(`Rule for ${clientIp} not found in SG ${securityGroupId} or did not match exactly.`);
            } else {
                console.error(`Error removing inbound rule for ${clientIp}:`, error);
                throw error;
            }
        }
    };

    /**
     * Removes all inbound (ingress) rules from a specified security group.
     * It fetches the current rules and then revokes them.
     * @param config
     */
    public removeAllInboundRules = async (config: RemoveAllInboundRulesConfig): Promise<void> => {
        const {securityGroupId} = config;

        console.log(`Removing all inbound rules from security group ${securityGroupId}`);
        try {
            // 1. Describe the security group to get its current inbound rules
            const describeParams = {GroupIds: [securityGroupId]};
            const describeResponse = await backoffAndRetry(() =>
                this.ec2Client.send(new DescribeSecurityGroupsCommand(describeParams))
            );

            // Check if the security group was found
            if (!describeResponse.SecurityGroups || describeResponse.SecurityGroups.length === 0) {
                console.log(`Security group ${securityGroupId} not found.`);
                return;
            }

            const currentPermissions = describeResponse.SecurityGroups[0].IpPermissions;

            // Check if there are any rules to remove
            if (!currentPermissions || currentPermissions.length === 0) {
                console.log(`No inbound rules found to remove for SG ${securityGroupId}.`);
                return;
            }

            // 2. Prepare parameters for revocation using the fetched permissions
            const revokeParams = {
                GroupId: securityGroupId,
                IpPermissions: currentPermissions,
            };

            // 3. Call RevokeSecurityGroupIngressCommand
            await backoffAndRetry(() => this.ec2Client.send(new RevokeSecurityGroupIngressCommand(revokeParams)));
            console.log(`Successfully removed all inbound rules from SG ${securityGroupId}.`);
        } catch (error) {
            console.error(`Error removing all inbound rules from SG ${securityGroupId}:`, error);
            throw error;
        }
    };
}
