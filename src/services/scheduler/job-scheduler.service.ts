import PgBoss, {Job} from 'pg-boss'; // Import Job type
import moment from 'moment-timezone';

import {ActionDefinition, ScheduledJobConfig} from '../../controllers/action/action.schema';
import {ActionRepository} from '../../repositories/action/action.repository';
import {prisma} from '../../config/db.config';
import {TriggerType} from '@prisma/client';
import {ActionHelper} from '../../controllers/action/action.helper';
import {getPgBossInstance} from '../../config/pg-boss.config';

// Define an enum for the queue prefix
export enum QueuePrefix {
    ScheduledAction = 'scheduled-action-',
}

export class JobSchedulerService {
    private boss: PgBoss;
    private actionRepository: ActionRepository;
    private actionHelper: ActionHelper;

    constructor() {
        this.actionRepository = new ActionRepository(prisma);
        this.actionHelper = new ActionHelper();
        this.boss = getPgBossInstance() || new PgBoss({connectionString: process.env.DATABASE_URL});
        this.boss.on('error', error => console.error('PgBoss error:', error));
    }

    /**
     * Initializes the JobSchedulerService, starts PgBoss,
     * and registers workers for existing schedules found in the database.
     */
    public async initialize(): Promise<void> {
        try {
            await this.boss.start();
            console.log('PgBoss started successfully');

            // Fetch existing schedules relevant to this service and register workers
            await this.registerWorkersForExistingSchedules();
        } catch (error) {
            console.error('Failed to initialize job scheduler:', error);
            throw error; // Re-throw to indicate initialization failure
        }
    }

    /**
     * Ensures a queue with the given name exists. Handles 'already exists' errors gracefully.
     * @param queueName The name of the queue to create.
     */
    private async ensureQueueExists(queueName: string): Promise<void> {
        try {
            // Explicitly create the queue.
            // Add queue-specific options as the second argument if needed (e.g., { retryLimit: 3 })
            await this.boss.createQueue(queueName);
            console.log(`Ensured queue exists: ${queueName}`);
        } catch (error: any) {
            // PostgreSQL error code 42P07: duplicate_table (or relation already exists)
            // Check the specific error code/message from your pg driver if different
            if (error.code === '42P07' || (error.message && error.message.includes('already exists'))) {
                console.log(`Queue ${queueName} already exists, continuing...`);
            } else {
                console.error(`Error creating queue ${queueName}:`, error);
                throw new Error(`Failed to ensure queue exists: ${error.message}`);
            }
        }
    }

    /**
     * Fetches existing schedules matching the service prefix and registers workers.
     */
    private async registerWorkersForExistingSchedules(): Promise<void> {
        try {
            console.log('Fetching existing schedules to register workers...');
            const schedules = await this.boss.getSchedules();

            let registeredCount = 0;
            for (const schedule of schedules) {
                // Check if the schedule name matches our dynamic prefix
                if (schedule.name.startsWith(QueuePrefix.ScheduledAction)) {
                    const queueName = schedule.name;
                    console.log(`Registering worker on restart for queue: ${schedule.name}`);

                    await this.ensureQueueExists(queueName);

                    // Register worker using the shared handler, ensuring 'this' context
                    await this.boss.work(schedule.name, this.handleScheduledAction.bind(this));
                    registeredCount++;
                }
            }
            console.log(`Registered workers for ${registeredCount} existing schedules.`);
        } catch (error) {
            console.error('Error fetching schedules or registering workers on startup:', error);
        }
    }

    /**
     * Shared handler logic for processing scheduled action jobs.
     * Handles an array of jobs as expected by pg-boss.
     */
    private async handleScheduledAction(jobs: Job<any>[]): Promise<void> {
        console.log(`Handling scheduled action jobs...`);
        if (!Array.isArray(jobs) || jobs.length === 0) {
            console.error('Received empty job array');
            return;
        }

        const job = jobs[0];
        const scheduleName = job.name;
        console.log(`Received job ${job.id} from queue ${scheduleName}`);

        if (!job.data || typeof job.data !== 'object') {
            console.error(`Job ${job.id} has invalid or missing data.`);
            await this.boss.fail(job.id, 'Invalid job data structure');
            return;
        }

        const {actionId, ip, userEmail} = job.data;

        if (!actionId) {
            console.error(`Job ${job.id} data is missing actionId.`);
            await this.boss.fail(job.id, 'Missing actionId in job data');
            return;
        }

        console.log(`Processing job ${job.id} for action ${actionId}`);

        try {
            // Fetch the action from the database
            const action = await this.actionRepository.findOne(actionId);

            if (!action || !action.enabled) {
                console.warn(`Action ${actionId} not found or disabled for job ${job.id}. Marking job as failed.`);
                await this.boss.fail(job.id, 'Action not found or disabled');
                return;
            }

            await this.actionHelper.execute(action as unknown as ActionDefinition, ip, userEmail);

            console.log(`Successfully processed job ${job.id} for action ${actionId}`);
            await this.boss.complete(job.name, job.id);
        } catch (error: any) {
            console.error(`Error executing scheduled job ${job.id} for action ${actionId}:`, error);
            // Fail the job so pg-boss handles retries based on queue config
            await this.boss.fail(job.id, error.message || 'Unknown error during execution');
        }
    }

    /**
     * Convert UTC cron expression to server's local timezone.
     * Note: Ensure server timezone is correctly configured.
     */
    private convertCronToLocalTimezone(cronExpression: string, timezone?: string): string {
        const localTimezone = timezone || moment.tz.guess();
        const parts = cronExpression.split(' ');
        if (parts.length !== 5) {
            console.warn('Invalid cron expression format, using as-is:', cronExpression);
            return cronExpression;
        }

        // Basic hour adjustment (consider libraries for complex cron parsing if needed)
        try {
            const utcOffsetHours = moment().tz(localTimezone).utcOffset() / 60;
            const hourPart = parts[1];

            // Simple adjustment for specific hour or '*'
            if (hourPart === '*') {
                // '*' remains '*'
            } else if (!isNaN(parseInt(hourPart, 10))) {
                let hour = parseInt(hourPart, 10);
                hour = hour - utcOffsetHours; // Apply offset
                // Handle wrap-around within 0-23 range
                hour = ((hour % 24) + 24) % 24;
                parts[1] = hour.toString();
            } else {
                // More complex patterns (ranges, steps, lists) require more sophisticated parsing.
                // For simplicity, log a warning and return original if complex pattern detected.
                console.warn(
                    `Complex hour pattern "${hourPart}" in cron ${cronExpression}. Timezone conversion might be inaccurate. Using original.`
                );
                return cronExpression;
            }
            return parts.join(' ');
        } catch (e) {
            console.error('Error converting cron timezone, using original:', e);
            return cronExpression;
        }
    }

    /**
     * Schedule a job based on the action configuration and register a worker for its queue.
     */
    public async scheduleJob(action: ActionDefinition): Promise<string> {
        if (!this.boss || !(await this.boss.isInstalled())) {
            throw new Error('Job scheduler not initialized or not started.');
        }

        if (action.triggerType !== TriggerType.scheduled_job) {
            throw new Error('Action is not a scheduled job');
        }

        const config = action.schedulerConfig as ScheduledJobConfig;
        if (!config || !config.customCronExpression) {
            throw new Error('Scheduler config or cron expression is missing for scheduled job');
        }

        // Generate the unique schedule/queue name using the enum prefix
        const scheduleName = `${QueuePrefix.ScheduledAction}${action.id}`;

        // Convert UTC cron to server's local timezone for scheduling
        const localCronExpression = this.convertCronToLocalTimezone(config.customCronExpression);
        console.log(
            `Action ${action.id}: Scheduling '${scheduleName}' with UTC cron: ${config.customCronExpression} -> Local cron: ${localCronExpression}`
        );

        try {
            const jobData = {
                actionId: action.id,
                ip: '0.0.0.0',
                userEmail: 'scheduler@system',
            };

            await this.ensureQueueExists(scheduleName);

            // await this.boss.offWork(scheduleName);
            await this.boss.work(scheduleName, this.handleScheduledAction.bind(this));
            console.log(`Registered worker for queue ${scheduleName}`);

            await this.boss.schedule(scheduleName, localCronExpression, jobData);
            console.log(`Scheduled job creation for ${scheduleName}`);

            return scheduleName; // Return the unique schedule name
        } catch (error: any) {
            console.error(`Error scheduling job or registering worker for ${scheduleName}:`, error);
            throw new Error(`Failed to schedule job: ${error.message}`);
        }
    }

    /**
     * Cancel a scheduled job creation and stop its associated worker.
     * @param scheduleName The unique name of the schedule/queue (e.g., "scheduled-action-123")
     */
    public async cancelJob(scheduleName: string): Promise<void> {
        if (!this.boss || !(await this.boss.isInstalled())) {
            throw new Error('Job scheduler not initialized or not started.');
        }

        try {
            await this.boss.unschedule(scheduleName);
            console.log(`Unscheduled job creation for ${scheduleName}`);

            // Stop the worker listening on this specific queue
            await this.boss.offWork(scheduleName);
            console.log(`Unregistered worker for queue ${scheduleName}`);
        } catch (error: any) {
            console.error(`Error unscheduling job or stopping worker for ${scheduleName}:`, error);
            throw new Error(`Failed to cancel job: ${error.message}`);
        }
    }

    /**
     * Reschedule a job: cancels the old one (if specified) and schedules the new one.
     * Handles worker registration/unregistration via cancelJob and scheduleJob.
     */
    public async rescheduleJob(action: ActionDefinition, oldScheduleName?: string): Promise<string> {
        if (!this.boss || !(await this.boss.isInstalled())) {
            throw new Error('Job scheduler not initialized or not started.');
        }

        // Cancel the old job and its worker if an old schedule name is provided
        if (oldScheduleName) {
            console.log(`Rescheduling: Cancelling old schedule ${oldScheduleName}`);
            await this.cancelJob(oldScheduleName); // This now handles unschedule + offWork
        }

        // Schedule the new job (this will handle schedule + work)
        console.log(`Rescheduling: Scheduling new job for action ${action.id}`);
        // Ensure the action has the latest configuration before scheduling
        return this.scheduleJob(action);
    }

    /**
     * Stops the PgBoss instance gracefully.
     */
    public async stop(): Promise<void> {
        if (this.boss && (await this.boss.isInstalled())) {
            console.log('Stopping Job Scheduler (PgBoss)...');
            await this.boss.stop({graceful: true}); // Use graceful stop if available
            console.log('Job scheduler stopped');
        } else {
            console.log('Job scheduler is not running or already stopped');
        }
    }
}
