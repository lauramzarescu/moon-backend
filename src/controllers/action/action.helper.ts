import {ActionType} from '@prisma/client';
import {
    ActionDefinition,
    AddInboundRuleConfig,
    RemoveAllInboundRulesConfig,
    RemoveInboundRuleConfig,
} from './action.schema';
import {ec2Client} from '../../config/aws.config';
import {EC2Service} from '../../services/aws/ec2.service';
import {ActionRepository} from '../../repositories/action/action.repository';
import {prisma} from '../../config/db.config';
import {RulesHelper} from '../../utils/rules-helper';

export class ActionHelper {
    private readonly ec2Service: EC2Service;
    private readonly actionRepository: ActionRepository;

    constructor() {
        this.ec2Service = new EC2Service(ec2Client);
        this.actionRepository = new ActionRepository(prisma);
    }

    /**
     * Executes an action based on its type and configuration.
     * @param action The action definition to execute.
     * @param ip The IP address to use for the action.
     * @param userEmail
     */
    public async execute(action: ActionDefinition, ip: string = '127.0.0.1', userEmail = '-') {
        switch (action.actionType) {
            case ActionType.add_inbound_rule:
                const actionConfig = action.config as AddInboundRuleConfig;
                actionConfig.ip = ip;

                await this.executeAddInboundRule(actionConfig, userEmail);
                break;

            case ActionType.remove_inbound_rule:
                const removeActionConfig = action.config as RemoveInboundRuleConfig;
                removeActionConfig.ip = removeActionConfig.ip || ip;
                await this.executeRemoveInboundRule(removeActionConfig);
                break;

            case ActionType.remove_all_inbound_rules:
                const removeConfig = action.config as {securityGroupId: string};
                await this.executeRemoveAllInboundRules(removeConfig);
                break;
            default:
                console.error('Unknown action type');
        }
    }

    public async executeAddInboundRule(config: AddInboundRuleConfig, userEmail: string) {
        // Parse the port range
        const {fromPort, toPort} = RulesHelper.parsePortRange(config.portRange);

        // Ensure IP is in CIDR format
        const ipCidr = RulesHelper.ensureCidrFormat(config.ip || '-');

        // Parse the description template
        const description = RulesHelper.parseDynamicDescription(config, userEmail);

        // Execute the EC2 security group rule addition
        return this.ec2Service.addInboundRuleForClientIp(
            config.securityGroupId,
            ipCidr,
            fromPort,
            toPort,
            config.protocol,
            description
        );
    }

    public executeRemoveInboundRule(config: RemoveInboundRuleConfig) {
        return this.ec2Service.removeInboundRuleForClientIp(config);
    }

    public executeRemoveAllInboundRules(config: RemoveAllInboundRulesConfig) {
        return this.ec2Service.removeAllInboundRules(config);
    }

    public static executeSendNotification(config: {channel: string; recipient: string; messageTemplate: string}) {
        console.log('Sending notification', config);
        // Implement notification logic here
        return Promise.resolve(`Notification sent to ${config.recipient}`);
    }
}
