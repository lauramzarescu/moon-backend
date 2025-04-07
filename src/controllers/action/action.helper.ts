import {ActionType} from '@prisma/client';
import {ActionDefinition, AddInboundRuleConfig} from './action.schema';
import {ec2Client} from '../../config/aws.config';
import {EC2Service} from '../../services/aws/ec2.service';

export class ActionHelper {
    private readonly ec2Service: EC2Service;

    constructor() {
        this.ec2Service = new EC2Service(ec2Client);
    }

    /**
     * Executes an action based on its type and configuration.
     * @param action The action definition to execute.
     * @param ip The IP address to use for the action.
     */
    public async execute(action: ActionDefinition, ip: string = '10.20.8.106') {
        if (!ip) {
            throw new Error('IP address is required for executing the action');
        }

        switch (action.actionType) {
            case ActionType.add_inbound_rule:
                const actionConfig = action.config as AddInboundRuleConfig;
                await this.executeInboundRule(actionConfig);
                break;
            default:
                console.error('Unknown action type');
        }
    }

    public async executeInboundRule(config: AddInboundRuleConfig) {
        console.log('Executing inbound rule', config);

        // Check if the port is a single port or a port range
        let fromPort: number;
        let toPort: number;

        if (config.portRange.includes('-')) {
            // It's a port range (e.g., "80-443")
            const [start, end] = config.portRange.split('-').map(p => parseInt(p.trim(), 10));
            fromPort = start;
            toPort = end;
        } else {
            // It's a single port (e.g., "22")
            fromPort = parseInt(config.portRange.trim(), 10);
            toPort = fromPort;
        }

        // Validate the ports
        if (isNaN(fromPort) || isNaN(toPort)) {
            throw new Error(`Invalid port range format: ${config.portRange}`);
        }

        if (fromPort < 1 || fromPort > 65535 || toPort < 1 || toPort > 65535) {
            throw new Error(`Port values must be between 1 and 65535. Got: ${config.portRange}`);
        }

        if (fromPort > toPort) {
            throw new Error(
                `Invalid port range: start port (${fromPort}) must be less than or equal to end port (${toPort})`
            );
        }

        console.log(config.protocol);
        // Execute the EC2 security group rule addition
        return this.ec2Service.addInboundRuleForClientIp(
            config.securityGroupId,
            config.ip || '-',
            fromPort,
            toPort,
            config.protocol,
            config.descriptionTemplate
        );
    }

    public static executeSendNotification(config: {channel: string; recipient: string; messageTemplate: string}) {
        console.log('Sending notification', config);
        // Implement notification logic here
        return Promise.resolve(`Notification sent to ${config.recipient}`);
    }
}
