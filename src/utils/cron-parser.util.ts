import cronstrue from 'cronstrue';
import moment from 'moment';
import awsCronParser from 'aws-cron-parser';
import cronParser from 'cron-parser';

const RUNS_LIMIT = 10;

export const parseCronToHumanReadable = (
    rawExpression: string
): {
    description: string;
    nextRun: string;
    nextRuns: string[];
} => {
    try {
        let cronExpression: string;
        let isAwsCron = false;

        // Check if it's AWS cron format with cron(...)
        const awsMatches = rawExpression.match(/cron\((.*?)\)/);
        if (awsMatches) {
            cronExpression = awsMatches[1];
            isAwsCron = true;
        } else {
            // Assume it's a classic cron expression
            cronExpression = rawExpression.trim();
        }

        // Validate that we have a valid cron expression
        if (!cronExpression) {
            return {
                description: 'Invalid cron expression',
                nextRun: 'N/A',
                nextRuns: [],
            };
        }

        const offsetInMinutes = new Date().getTimezoneOffset();
        // Get human-readable description using cronstrue
        const description = cronstrue.toString(cronExpression, {
            tzOffset: -(offsetInMinutes / 60),
            verbose: true,
            use24HourTimeFormat: true,
        });

        // Calculate next runs based on cron format
        const nextRuns: string[] = [];
        let nextRunFormatted = 'N/A';

        if (isAwsCron) {
            // Use awsCronParser for AWS cron format
            const cronOptions = awsCronParser.parse(cronExpression);
            const initialNextRun = awsCronParser.next(cronOptions, new Date());
            nextRunFormatted = initialNextRun ? moment(initialNextRun).toISOString() : 'N/A';

            let currentNextRun = initialNextRun;
            for (let i = 0; i < RUNS_LIMIT; i++) {
                if (!currentNextRun) break;
                currentNextRun = awsCronParser.next(cronOptions, currentNextRun);
                if (currentNextRun) {
                    nextRuns.push(moment(currentNextRun).toISOString());
                }
            }
        } else {
            // Use cron-parser for classic cron format
            const interval = cronParser.parse(cronExpression);
            nextRunFormatted = moment(interval.next().toDate()).toISOString();

            // Get next runs
            for (let i = 0; i < RUNS_LIMIT; i++) {
                try {
                    const nextDate = interval.next().toDate();
                    nextRuns.push(moment(nextDate).toISOString());
                } catch (e) {
                    break;
                }
            }
        }

        return {
            description,
            nextRun: nextRunFormatted,
            nextRuns,
        };
    } catch (error) {
        console.error('Error parsing cron expression:', error);
        return {
            description: 'Invalid cron expression',
            nextRun: 'N/A',
            nextRuns: [],
        };
    }
};
