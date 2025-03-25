import {DescribeRuleCommand, EventBridgeClient, ListRulesCommand, ListRuleNamesByTargetCommand} from "@aws-sdk/client-eventbridge";
import {ScheduledTaskInterface} from "../../interfaces/aws-entities/scheduled-task.interface";
import {parseCronToHumanReadable} from "../../utils/cron-parser.util";
import {DescribeRuleCommandOutput} from "@aws-sdk/client-eventbridge/dist-types/commands/DescribeRuleCommand";
import {backoffAndRetry} from "../../utils/backoff.util";
import {UpdateServiceCommand} from "@aws-sdk/client-ecs";

export class SchedulerService {
    private readonly eventBridge: EventBridgeClient;

    constructor() {
        this.eventBridge = new EventBridgeClient({region: process.env.AWS_REGION});
    }

    public getECSScheduledTasks = async (clusterArn: string, clusterName: string): Promise<any[]> => {
        try {
            const detailedRules: DescribeRuleCommandOutput[] = [];

            const rulesResponse = await this.eventBridge.send(new ListRuleNamesByTargetCommand({TargetArn: clusterArn}));

            for (const ruleName of rulesResponse.RuleNames ?? []) {
                detailedRules.push(await this.getRuleDetails(ruleName));
            }

            return this.mapScheduledTasks(detailedRules, clusterName);
        } catch (error) {
            console.error("Error getting scheduled tasks:", error);
            throw error;
        }
    }

    public getRuleDetails = async (ruleArn: string, eventBusName = "default"): Promise<DescribeRuleCommandOutput> => {
        return await backoffAndRetry(() =>
            this.eventBridge.send(new DescribeRuleCommand({
                Name: ruleArn,
                EventBusName: eventBusName
            }))
        )
    }

    private mapScheduledTasks = (rules: any[], cluster: string): ScheduledTaskInterface[] => {
        return rules.map(rule => {
            const readableCron = parseCronToHumanReadable(rule.ScheduleExpression || '');

            return {
                name: rule.Name || '',
                cron: rule.ScheduleExpression || '',
                command: rule.State || 'DISABLED',
                status: rule.State as 'DISABLED' | 'ENABLED',
                eventBusName: rule.EventBusName || '',
                arn: rule.Arn || '',
                readableCron: readableCron.description,
                nextRun: readableCron.nextRun,
                nextRuns: readableCron.nextRuns,
                clusterName: cluster
            };
        });
    }
}
