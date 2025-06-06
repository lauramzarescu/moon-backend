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
import logger from '../../config/logger';
import {DescribeInstancesCommandOutput} from '@aws-sdk/client-ec2/dist-types/commands';
import {Instance, Reservation} from '@aws-sdk/client-ec2/dist-types/models';

export class EC2Service {
    private readonly ec2Client: EC2Client;
    private instanceCache: InstanceInterface[] | null = null;
    private cacheTimestamp: number = 0;
    private readonly CACHE_TTL = 5000;

    constructor(ec2Client: EC2Client) {
        this.ec2Client = ec2Client;
    }

    public getInstances = async (useCache: boolean = false): Promise<InstanceInterface[]> => {
        // Use cache if requested and cache is still valid
        if (useCache && this.instanceCache && Date.now() - this.cacheTimestamp < this.CACHE_TTL) {
            logger.info('[EC2] Returning cached instances');
            return this.instanceCache;
        }

        logger.info('[EC2] Fetching fresh instances from AWS');
        const instanceResponse = await backoffAndRetry(() => this.ec2Client.send(new DescribeInstancesCommand({})));

        const instances = this.mapInstances(instanceResponse);

        // Update cache
        this.instanceCache = instances;
        this.cacheTimestamp = Date.now();

        return instances;
    };

    private mapInstances = (instanceResponse: DescribeInstancesCommandOutput): InstanceInterface[] => {
        const reservations = instanceResponse.Reservations || [];
        const instances = reservations.flatMap((r: Reservation) => r.Instances || []);

        return instances
            .filter((instance: Instance) => instance.State?.Name === 'running')
            .map((instance: Instance) => ({
                id: instance.InstanceId ?? 'N/A',
                name: instance.Tags?.filter((tag: Tag) => tag.Key === 'Name')[0]?.Value ?? 'N/A',
                type: instance.InstanceType ?? 'N/A',
                state: instance.State?.Name,
                publicIp: instance.PublicIpAddress ?? 'N/A',
                primaryPrivateIp: instance.PrivateIpAddress ?? 'N/A',
                privateIpAddresses:
                    instance.NetworkInterfaces?.flatMap(
                        (networkInterface: any) =>
                            networkInterface.PrivateIpAddresses?.map(
                                (privateIpAddress: any) => privateIpAddress.PrivateIpAddress
                            ) || []
                    ) || [],
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
                            Description: description,
                        },
                    ],
                },
            ],
        };

        try {
            await backoffAndRetry(() => this.ec2Client.send(new AuthorizeSecurityGroupIngressCommand(params)));
            logger.info(
                `Successfully added inbound rule for ${clientIp} to SG ${securityGroupId} on port ${fromPort}-${toPort}/${protocol}`
            );
        } catch (error: any) {
            logger.error(`Error adding inbound rule for ${clientIp}`, error?.message);
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
            await backoffAndRetry(() => this.ec2Client.send(new RevokeSecurityGroupIngressCommand(params)));
            logger.info(`Successfully revoked inbound rule for ${clientIp} from SG ${securityGroupId}`);
        } catch (error: any) {
            // For non-default VPCs, a non-matching rule throws InvalidPermission.NotFound
            if (error.name === 'InvalidPermission.NotFound') {
                logger.warn(`Rule for ${clientIp} not found in SG ${securityGroupId} or did not match exactly.`);
            } else {
                logger.error(`Error removing inbound rule for ${clientIp}:`, error.message);
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

        logger.info(`Removing all inbound rules from security group ${securityGroupId}`);
        try {
            // 1. Describe the security group to get its current inbound rules
            const describeParams = {GroupIds: [securityGroupId]};
            const describeResponse = await backoffAndRetry(() =>
                this.ec2Client.send(new DescribeSecurityGroupsCommand(describeParams))
            );

            // Check if the security group was found
            if (!describeResponse.SecurityGroups || describeResponse.SecurityGroups.length === 0) {
                logger.info(`Security group ${securityGroupId} not found.`);
                return;
            }

            let currentPermissions = describeResponse.SecurityGroups[0].IpPermissions || [];

            // Check if there are any rules to remove
            if (currentPermissions.length === 0) {
                logger.info(`No inbound rules found to remove for SG ${securityGroupId}.`);
                return;
            }

            // Apply filters based on config
            if (config.protocol) {
                currentPermissions = currentPermissions.filter(permission => permission.IpProtocol === config.protocol);
            }

            if (config.portRange) {
                const {fromPort, toPort} = RulesHelper.parsePortRange(config.portRange);
                currentPermissions = currentPermissions.filter(
                    permission => permission.FromPort === fromPort && permission.ToPort === toPort
                );
            }

            // Check if there are any rules left after filtering
            if (currentPermissions.length === 0) {
                logger.info(`No matching inbound rules found to remove for SG ${securityGroupId}.`);
                return;
            }

            // 2. Prepare parameters for revocation using the filtered permissions
            const revokeParams = {
                GroupId: securityGroupId,
                IpPermissions: currentPermissions,
            };

            // 3. Call RevokeSecurityGroupIngressCommand
            await backoffAndRetry(() => this.ec2Client.send(new RevokeSecurityGroupIngressCommand(revokeParams)));
            logger.info(`Successfully removed filtered inbound rules from SG ${securityGroupId}.`);
        } catch (error: any) {
            logger.error(`Error removing inbound rules from SG ${securityGroupId}:`, error.message);
            throw error;
        }
    };
}
