import * as express from 'express';
import {prisma} from '../../config/db.config';
import {ActionRepository} from '../../repositories/action/action.repository';
import {z} from 'zod';
import {
    ActionDefinition,
    CreateActionDto,
    createActionInputSchema,
    UpdateActionDto,
    updateActionInputSchema,
} from './action.schema';
import {UserRepository} from '../../repositories/user/user.repository';
import {TriggerType, User} from '@prisma/client';
import {AuditLogEnum} from '../../enums/audit-log/audit-log.enum';
import {AuditLogHelper} from '../audit-log/audit-log.helper';
import {JobSchedulerService} from '../../services/scheduler/job-scheduler.service'; // Import the scheduler

export class ActionsController {
    static actionRepository = new ActionRepository(prisma);
    static readonly userRepository = new UserRepository(prisma);
    static readonly auditHelper = new AuditLogHelper();
    static readonly jobScheduler = new JobSchedulerService(); // Add the scheduler instance

    private constructor() {}

    static list = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
        try {
            const user = res.locals.user as User;
            const actions = await this.actionRepository.findMany({
                organizationId: user.organizationId,
            });

            res.json(actions);
        } catch (error: any) {
            console.error('Error listing actions:', error);
            res.status(500).json({
                message: 'Failed to list actions',
                error: error.message,
            });
        }
    };

    static get = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
        const {id} = req.params;
        try {
            const user = res.locals.user as User;

            const action = await this.actionRepository.findOne(id);

            if (!action) {
                res.status(404).json({message: 'Action not found'});
                return;
            }

            // Verify organization ownership
            if (action.organizationId !== user.organizationId) {
                res.status(403).json({message: 'Not authorized to view this action'});
                return;
            }

            res.json(action);
        } catch (error: any) {
            console.error(`Error fetching action ${id}:`, error);
            res.status(500).json({
                message: 'Failed to get action details',
                error: error.message,
            });
        }
    };

    static create = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
        try {
            const user = res.locals.user as User;
            const validatedData: CreateActionDto = createActionInputSchema.parse(req.body);

            // Create the action in the database first
            let newAction = (await this.actionRepository.create({
                name: validatedData.name,
                actionType: validatedData.actionType,
                triggerType: validatedData.triggerType,
                config: validatedData.config || {},
                schedulerConfig: validatedData.schedulerConfig || {},
                enabled: validatedData.enabled,
                organizationId: user.organizationId,
            })) as unknown as ActionDefinition;

            // If it's a scheduled job, schedule it and update the action with the jobId
            if (newAction.triggerType === TriggerType.scheduled_job && newAction.enabled) {
                try {
                    const jobId = await this.jobScheduler.scheduleJob(newAction);

                    // Update the action's config to include the jobId
                    const updatedConfig = {
                        ...(newAction.config as Object),
                        jobId,
                    };

                    // Update the action in the database with the jobId
                    newAction = (await this.actionRepository.update(newAction.id, {
                        config: updatedConfig,
                    })) as unknown as ActionDefinition;
                } catch (schedulerError: any) {
                    // If scheduling fails, delete the action we just created
                    await this.actionRepository.delete(newAction.id);
                    console.error('Error scheduling job after action creation:', schedulerError);

                    throw new Error(`Failed to schedule job: ${schedulerError.message}`);
                }
            }

            await this.auditHelper.create({
                userId: user?.id || '-',
                organizationId: user?.organizationId || '-',
                action: AuditLogEnum.ACTION_CREATED,
                details: {
                    ip: (req as any).ipAddress, // Assuming ipAddress is added by middleware
                    info: {
                        userAgent: req.headers['user-agent'],
                        email: user?.email || '-',
                        description: `Action ${newAction.name} created`,
                        objectNew: newAction,
                    },
                },
            });

            res.status(201).json(newAction);
        } catch (error: any) {
            if (error instanceof z.ZodError) {
                res.status(400).json({message: 'Validation failed', details: error.flatten().fieldErrors});
                return;
            }
            console.error('Error creating action:', error);
            res.status(500).json({
                message: 'Failed to create action',
                error: error.message,
            });
        }
    };

    static update = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
        const {id} = req.params;

        try {
            const user = res.locals.user as User;
            const validatedData: UpdateActionDto = updateActionInputSchema.parse(req.body);

            const existingAction = await this.actionRepository.findOne(id);
            if (!existingAction) {
                res.status(404).json({message: 'Action not found'});
                return;
            }

            // Verify organization ownership
            if (existingAction.organizationId !== user.organizationId) {
                res.status(403).json({message: 'Not authorized to update this action'});
                return;
            }

            // Store old action for audit log
            const oldAction = {...existingAction};

            // Update the action in the database first
            let updatedAction = (await this.actionRepository.update(id, {
                name: validatedData.name,
                actionType: validatedData.actionType,
                triggerType: validatedData.triggerType,
                config: validatedData.config !== undefined ? validatedData.config || {} : undefined,
                schedulerConfig: validatedData.schedulerConfig || {},
                enabled: validatedData.enabled,
            })) as unknown as ActionDefinition;

            // Handle scheduled job logic if the action is or becomes scheduled
            const wasScheduled = existingAction.triggerType === TriggerType.scheduled_job;
            const isScheduled = updatedAction.triggerType === TriggerType.scheduled_job;
            const oldJobId = (existingAction.config as {jobId?: string})?.jobId;
            const newJobId = (updatedAction.config as {jobId?: string})?.jobId;

            if (wasScheduled || isScheduled) {
                // Case 1: Was scheduled, now disabled or deleted (handled by delete)
                if (wasScheduled && !updatedAction.enabled && oldJobId) {
                    try {
                        await this.jobScheduler.cancelJob(oldJobId);
                    } catch (schedulerError: any) {
                        console.error(`Error canceling job ${oldJobId} during disable:`, schedulerError);
                    }
                }

                // Case 2: Was scheduled and enabled, remains scheduled and enabled, config changed or enabled re-set to true
                else if (
                    wasScheduled &&
                    updatedAction.enabled &&
                    (validatedData.config !== undefined ||
                        validatedData.schedulerConfig !== undefined ||
                        validatedData.enabled)
                ) {
                    try {
                        // Cancel the old job if it existed
                        if (oldJobId) {
                            await this.jobScheduler.cancelJob(oldJobId);
                        }

                        // Schedule the new job with the updated action details
                        const newlyScheduledJobId = await this.jobScheduler.scheduleJob(updatedAction);

                        // Update the action's config with the new jobId if it changed
                        if (newlyScheduledJobId !== newJobId) {
                            const finalConfig = {
                                ...(updatedAction.config as Object),
                                jobId: newlyScheduledJobId,
                            };
                            updatedAction = (await this.actionRepository.update(id, {
                                config: finalConfig,
                            })) as unknown as ActionDefinition;
                        }
                    } catch (schedulerError: any) {
                        console.error(`Error rescheduling job for action ${id}:`, schedulerError);
                        res.status(500).json({
                            message: 'Action updated in DB, but failed to reschedule job.',
                            error: schedulerError.message,
                            action: updatedAction,
                        });
                        return;
                    }
                }

                // Case 3: Was NOT scheduled, now IS scheduled and enabled
                else if (!wasScheduled && isScheduled && updatedAction.enabled) {
                    try {
                        const newlyScheduledJobId = await this.jobScheduler.scheduleJob(updatedAction);
                        const finalConfig = {
                            ...(updatedAction.config as Object),
                            jobId: newlyScheduledJobId,
                        };
                        updatedAction = (await this.actionRepository.update(id, {
                            config: finalConfig,
                        })) as unknown as ActionDefinition;
                    } catch (schedulerError: any) {
                        console.error(
                            `Error scheduling job for action ${id} after trigger type change:`,
                            schedulerError
                        );
                        res.status(500).json({
                            message: 'Action updated in DB, but failed to schedule job.',
                            error: schedulerError.message,
                            action: updatedAction,
                        });
                        return;
                    }
                }
            }

            await this.auditHelper.create({
                userId: user?.id || '-',
                organizationId: user?.organizationId || '-',
                action: AuditLogEnum.ACTION_UPDATED,
                details: {
                    ip: (req as any).ipAddress,
                    info: {
                        userAgent: req.headers['user-agent'],
                        email: user?.email || '-',
                        description: `Action ${updatedAction.name} updated`,
                        objectOld: oldAction,
                        objectNew: updatedAction,
                    },
                },
            });

            res.json(updatedAction);
        } catch (error: any) {
            if (error instanceof z.ZodError) {
                res.status(400).json({message: 'Validation failed', details: error.flatten().fieldErrors});
                return;
            }
            console.error(`Error updating action ${id}:`, error);
            res.status(500).json({
                message: 'Failed to update action',
                error: error.message,
            });
        }
    };

    static delete = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
        const {id} = req.params;
        try {
            const user = res.locals.user as User;

            const existingAction = await this.actionRepository.findOne(id);

            if (!existingAction) {
                res.status(404).json({message: 'Action not found'});
                return;
            }

            // Verify organization ownership
            if (existingAction.organizationId !== user.organizationId) {
                res.status(403).json({message: 'Not authorized to delete this action'});
                return;
            }

            // If it's a scheduled job, cancel the scheduled job first
            if (existingAction.triggerType === TriggerType.scheduled_job) {
                const jobId = (existingAction.config as {jobId?: string})?.jobId;
                if (jobId) {
                    try {
                        await this.jobScheduler.cancelJob(jobId);
                    } catch (schedulerError: any) {
                        console.error(`Error canceling job ${jobId} during action deletion:`, schedulerError);
                        res.status(500).json({
                            message: 'Failed to cancel scheduled job before deleting action.',
                            error: schedulerError.message,
                        });
                        return;
                    }
                }
            }

            // Delete the action from the database
            await this.actionRepository.delete(id);

            await this.auditHelper.create({
                userId: user?.id || '-',
                organizationId: user?.organizationId || '-',
                action: AuditLogEnum.ACTION_DELETED,
                details: {
                    ip: (req as any).ipAddress, // Assuming ipAddress is added by middleware
                    info: {
                        userAgent: req.headers['user-agent'],
                        email: user?.email || '-',
                        description: `Action ${existingAction.name} deleted`,
                        objectOld: existingAction,
                    },
                },
            });

            res.status(204).send();
        } catch (error: any) {
            console.error(`Error deleting action ${id}:`, error);
            res.status(500).json({
                message: 'Failed to delete action',
                error: error.message,
            });
        }
    };
}
