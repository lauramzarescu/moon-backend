import cronstrue from 'cronstrue';
import moment from "moment";
import awsCronParser from "aws-cron-parser";

const RUNS_LIMIT = 10;

export const parseCronToHumanReadable = (rawExpression: string): {
    description: string;
    nextRun: string
    nextRuns: string[]
} => {
    try {
        // Extract expression between parentheses
        const matches = rawExpression.match(/cron\((.*?)\)/);
        if (!matches) {
            return {
                description: rawExpression,
                nextRun: 'N/A',
                nextRuns: []
            };
        }

        const cronExpression = matches[1];
        const cron = cronstrue.toString(cronExpression, {verbose: true, use24HourTimeFormat: true})
        const cronOptions = awsCronParser.parse(cronExpression);

        // Calculate next run
        const initialNextRun = awsCronParser.next(cronOptions, new Date());
        const nextRunFormatted = initialNextRun ? moment(initialNextRun).toISOString() : 'N/A';
        const nextRuns: string[] = [];

        let currentNextRun = initialNextRun;
        for (let i = 0; i < RUNS_LIMIT; i++) {
            if (!currentNextRun) break;
            currentNextRun = awsCronParser.next(cronOptions, currentNextRun);
            nextRuns.push(moment(currentNextRun).toISOString());
        }

        return {
            description: cron,
            nextRun: nextRunFormatted,
            nextRuns
        }
    } catch (error) {
        return {
            description: 'Invalid cron expression',
            nextRun: 'N/A',
            nextRuns: []
        }
    }
}
