import PgBoss from 'pg-boss';
import {ActionDefinition, ScheduledJobConfig} from '../../controllers/action/action.schema';
import {ActionRepository} from '../../repositories/action/action.repository';
import {prisma} from '../../config/db.config';
import {TriggerType} from '@prisma/client';
import {ActionHelper} from '../../controllers/action/action.helper';
import {getPgBossInstance} from '../../config/pg-boss.config';

export class JobSchedulerService {
    private boss: PgBoss;
    private actionRepository: ActionRepository;
    private actionHelper: ActionHelper;

    constructor() {
        this.actionRepository = new ActionRepository(prisma);
        this.actionHelper = new ActionHelper();
        this.boss = getPgBossInstance() || new PgBoss(process.env.DATABASE_URL as string);
    }

    public async initialize(): Promise<void> {
        try {
            await this.boss.start();
            console.log('PgBoss started successfully');

            // Create the queue before using it
            await this.boss.createQueue('scheduled-action');

            // Register worker for scheduled jobs
            this.boss.work('scheduled-action', async job => {
                try {
                    const {actionId, ip, userEmail} = (job as any).data;

                    // Fetch the action from the database
                    const action = await this.actionRepository.findOne(actionId);
                    if (!action || !action.enabled) {
                        return {success: false, error: 'Action not found or disabled'};
                    }

                    // Execute the action
                    await this.actionHelper.execute(action as unknown as ActionDefinition, ip, userEmail);

                    return {success: true, actionId};
                } catch (error: any) {
                    console.error('Error executing scheduled job:', error);
                    return {success: false, error: error.message};
                }
            });
        } catch (error) {
            console.error('Failed to initialize job scheduler:', error);
            throw error;
        }
    }

    /**
     * Schedule a job based on the action configuration
     */
    public async scheduleJob(action: ActionDefinition): Promise<string> {
        if (!this.boss) {
            throw new Error('Job scheduler not initialized. Call initialize() first.');
        }

        if (action.triggerType !== TriggerType.scheduled_job) {
            throw new Error('Action is not a scheduled job');
        }

        const config = action.schedulerConfig as ScheduledJobConfig;
        const startDate = new Date(config.startDate);

        // For recurring jobs, set up the appropriate cron expression
        let cronExpression: string | null = null;

        if (config.recurrence !== 'once') {
            console.log(`Scheduling ${action.name} with recurrence: ${config.recurrence}`);
            switch (config.recurrence) {
                case 'hourly':
                    cronExpression = `0 * * * *`; // Every hour at minute 0
                    break;
                case 'daily':
                    cronExpression = `${startDate.getMinutes()} ${startDate.getHours()} * * *`; // Same time every day
                    break;
                case 'weekly':
                    cronExpression = `${startDate.getMinutes()} ${startDate.getHours()} * * ${startDate.getDay()}`; // Same day of week
                    break;
                case 'monthly':
                    cronExpression = `${startDate.getMinutes()} ${startDate.getHours()} ${startDate.getDate()} * *`; // Same day of month
                    break;
                default:
                    throw new Error(`Unsupported recurrence pattern: ${config.recurrence}`);
            }
        }

        // Schedule the job with pg-boss
        try {
            let jobId: string | null;
            const jobData = {
                actionId: action.id,
                ip: '0.0.0.0', // Default IP for scheduled jobs
                userEmail: 'scheduler@system', // Default user for scheduled jobs
                actionType: action.actionType,
                actionConfig: action.config,
            };

            if (cronExpression) {
                // For recurring jobs, use the schedule method with cron
                await this.boss.schedule('scheduled-action', cronExpression, jobData, {
                    startAfter: startDate,
                    ...(config.endDate ? {endAfter: new Date(config.endDate)} : {}),
                });

                // For recurring jobs, we'll use the name as the job ID
                jobId = `scheduled-action-${action.id}`;
            } else {
                // For one-time jobs, use the send method with startAfter
                jobId = await this.boss.send('scheduled-action', jobData, {startAfter: startDate});
            }

            if (!jobId) {
                throw new Error('Failed to schedule job');
            }

            console.log(`Scheduled job ${jobId} for action ${action.id}`);
            return jobId;
        } catch (error: any) {
            console.error('Error scheduling job:', error);
            throw new Error(`Failed to schedule job: ${error.message}`);
        }
    }

    /**
     * Cancel a scheduled job
     */
    public async cancelJob(jobId: string): Promise<void> {
        if (!this.boss) {
            throw new Error('Job scheduler not initialized. Call initialize() first.');
        }

        await this.boss.cancel('scheduled-action', jobId);
    }

    /**
     * Reschedule a job with new configuration
     */
    public async rescheduleJob(action: ActionDefinition, oldJobId?: string): Promise<string> {
        if (!this.boss) {
            throw new Error('Job scheduler not initialized. Call initialize() first.');
        }

        // Cancel the old job if it exists
        if (oldJobId) {
            await this.cancelJob(oldJobId);
        }

        // Schedule the new job
        return this.scheduleJob(action);
    }

    /**
     * Get the status of a scheduled job
     */
    public async getJobDetails(jobId: string): Promise<any> {
        if (!this.boss) {
            throw new Error('Job scheduler not initialized. Call initialize() first.');
        }

        try {
            // The first parameter should be the queue name, which is 'scheduled-action' in your case
            return this.boss.getJobById('scheduled-action', jobId);
        } catch (error: any) {
            console.error('Error getting job details:', error);
            throw new Error(`Failed to get job details: ${error.message}`);
        }
    }

    public async stop() {
        if (this.boss) {
            await this.boss.stop();
            console.log('Job scheduler stopped');
        } else {
            console.log('Job scheduler is not running');
        }
    }
}
