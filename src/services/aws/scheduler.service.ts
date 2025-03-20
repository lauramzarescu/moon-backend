import {DescribeRuleCommand, EventBridgeClient, ListRulesCommand} from "@aws-sdk/client-eventbridge";
import {ScheduledTaskInterface} from "../../interfaces/aws-entities/scheduled-task.interface";
import {parseCronToHumanReadable} from "../../utils/cron-parser.util";

export class SchedulerService {
    private readonly eventBridge: EventBridgeClient;

    constructor() {
        this.eventBridge = new EventBridgeClient({region: process.env.AWS_REGION});
    }

    public async getECSScheduledTasks(clusterName: string): Promise<ScheduledTaskInterface[]> {
        try {
            const rulesResponse = await this.eventBridge.send(new ListRulesCommand({}));
            const filteredTasks = rulesResponse.Rules?.filter(rule => rule.ScheduleExpression) || [];

            return this.mapScheduledTasks(filteredTasks);
        } catch (error) {
            console.error("Error getting scheduled tasks:", error);
            throw error;
        }
    }

    public async getRuleDetails(ruleArn: string, eventBusName = "default") {
        try {
            const command = new DescribeRuleCommand({
                Name: ruleArn,
                EventBusName: eventBusName
            });

            return await this.eventBridge.send(command);
        } catch (error) {
            console.error("Error getting rule details:", error);
            throw error;
        }
    }

    private mapScheduledTasks(rules: any[]): ScheduledTaskInterface[] {
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
                nextRuns: readableCron.nextRuns
            };
        });
    }
}
