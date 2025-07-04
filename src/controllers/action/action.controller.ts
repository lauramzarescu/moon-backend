import * as express from 'express';
import {prisma} from '../../config/db.config';
import {ActionRepository} from '../../repositories/action/action.repository';
import {z} from 'zod';
import {
    ActionDefinition,
    actionExportSchema,
    actionsImportRequestSchema,
    CreateActionDto,
    createActionInputSchema,
    UpdateActionDto,
    updateActionInputSchema,
} from './action.schema';
import {UserRepository} from '../../repositories/user/user.repository';
import {TriggerType, User} from '@prisma/client';
import {AuditLogEnum} from '../../enums/audit-log/audit-log.enum';
import {AuditLogHelper} from '../audit-log/audit-log.helper';
import {JobSchedulerService} from '../../services/scheduler/job-scheduler.service';
import {parseCronToHumanReadable} from '../../utils/cron-parser.util';
import {ActionHelper} from './action.helper';
import logger from '../../config/logger';

export class ActionsController {
    static actionRepository = new ActionRepository(prisma);
    static readonly userRepository = new UserRepository(prisma);
    static readonly auditHelper = new AuditLogHelper();
    static readonly actionHelper = new ActionHelper();
    static readonly jobScheduler = new JobSchedulerService(); // Add the scheduler instance

    private constructor() {}

    static list = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
        try {
            const user = res.locals.user as User;
            const actions = (await this.actionRepository.findMany({
                organizationId: user.organizationId,
            })) as ActionDefinition[];

            for (const action of actions) {
                if (action.triggerType === TriggerType.scheduled_job && action.schedulerConfig?.customCronExpression) {
                    action.schedulerConfig.readableCronExpression = parseCronToHumanReadable(
                        action.schedulerConfig?.customCronExpression
                    );
                }
            }

            res.json(actions);
        } catch (error: any) {
            logger.error('Error listing actions:', error);
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
            logger.error(`Error fetching action ${id}:`, error);
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
                schedulerConfig: validatedData.schedulerConfig || null,
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
                    logger.error('Error scheduling job after action creation:', schedulerError);

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
            logger.error('Error creating action:', error);
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
                schedulerConfig: validatedData.schedulerConfig || null,
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
                        logger.error(`Error canceling job ${oldJobId} during disable:`, schedulerError);
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
                        logger.error(`Error rescheduling job for action ${id}:`, schedulerError);
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
                        logger.error(
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
            logger.error(`Error updating action ${id}:`, error);
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
                        logger.error(`Error canceling job ${jobId} during action deletion:`, schedulerError);
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

            res.status(200).json({message: 'Action deleted successfully'});
            return;
        } catch (error: any) {
            logger.error(`Error deleting action ${id}:`, error);
            res.status(500).json({
                message: 'Failed to delete action',
                error: error.message,
            });
        }
    };

    static refresh = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
        try {
            const user = res.locals.user as User;
            const actions = (await this.actionRepository.getActive(
                user.organizationId,
                TriggerType.page_refresh
            )) as ActionDefinition[];

            for (const action of actions) {
                try {
                    await this.actionHelper.execute(action, (req as any).ipAddress, user.email);
                } catch (error: any) {
                    logger.error(`Error executing action ${action.name}:`, error);
                }
            }

            res.status(200).json({message: 'Page refresh actions triggered.'});
        } catch (error: any) {
            logger.error('Error executing page refresh actions:', error);
            res.status(500).json({
                message: 'Failed to execute page refresh actions',
                error: error,
            });
        }
    };

    static exportActions = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
        try {
            const user = res.locals.user as User;

            const actions = (await this.actionRepository.findMany({
                organizationId: user.organizationId,
            })) as ActionDefinition[];

            const exportData = actions.map(action => {
                const cleanConfig = {...(action.config as object)};
                if ('jobId' in cleanConfig) {
                    delete (cleanConfig as any).jobId;
                }

                return actionExportSchema.parse({
                    name: action.name,
                    actionType: action.actionType,
                    triggerType: action.triggerType,
                    config: cleanConfig,
                    schedulerConfig: action.schedulerConfig,
                    enabled: action.enabled,
                    createdAt: (action as any).createdAt,
                    updatedAt: (action as any).updatedAt,
                });
            });

            res.setHeader('Content-Type', 'application/json');
            res.setHeader(
                'Content-Disposition',
                `attachment; filename="actions-export-${new Date().toISOString().split('T')[0]}.json"`
            );

            res.json({
                exportDate: new Date().toISOString(),
                organizationId: user.organizationId,
                totalActions: exportData.length,
                actions: exportData,
            });

            await this.auditHelper.create({
                userId: user?.id || '-',
                organizationId: user?.organizationId || '-',
                action: AuditLogEnum.ACTION_EXPORTED,
                details: {
                    ip: (req as any).ipAddress,
                    info: {
                        userAgent: req.headers['user-agent'],
                        email: user?.email || '-',
                        description: `Exported ${exportData.length} actions`,
                    },
                },
            });
        } catch (error: any) {
            logger.error('Error exporting actions:', error);
            res.status(500).json({
                message: 'Failed to export actions',
                error: error.message,
            });
        }
    };

    static importActions = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
        try {
            const user = res.locals.user as User;
            let validatedData;

            // Check if it's a file upload, base64 file object, or JSON body
            if ((req as any).file) {
                try {
                    const file = (req as any).file as Express.Multer.File;
                    const fileContent = file.buffer.toString('utf8');
                    const parsedData = JSON.parse(fileContent);

                    validatedData = actionsImportRequestSchema.parse(parsedData);
                } catch (parseError: any) {
                    res.status(400).json({
                        message: 'Invalid JSON file format',
                        error: parseError.message,
                    });
                    return;
                }
            } else if (req.body.file) {
                try {
                    const base64Data = req.body.file;
                    const decodedData = Buffer.from(base64Data, 'base64').toString('utf8');
                    const parsedData = JSON.parse(decodedData);

                    let actionsData;
                    if (Array.isArray(parsedData)) {
                        actionsData = {actions: parsedData};
                    } else if (parsedData.actions) {
                        actionsData = parsedData;
                    } else {
                        actionsData = {actions: [parsedData]};
                    }

                    validatedData = actionsImportRequestSchema.parse(actionsData);
                } catch (parseError: any) {
                    res.status(400).json({
                        message: 'Invalid base64 file data format',
                        error: parseError.message,
                    });
                    return;
                }
            } else {
                let bodyData = req.body;

                if (Array.isArray(bodyData)) {
                    bodyData = {actions: bodyData};
                }

                validatedData = actionsImportRequestSchema.parse(bodyData);
            }

            const results = {
                successful: [] as any[],
                failed: [] as any[],
                skipped: [] as any[],
            };

            for (const actionData of validatedData.actions) {
                try {
                    // Check if action with same name already exists
                    const existingActions = await this.actionRepository.findMany({
                        organizationId: user.organizationId,
                    });

                    const existingAction = existingActions.find(
                        (action: any) => action.name.toLowerCase() === actionData.name.toLowerCase()
                    );

                    if (existingAction) {
                        results.skipped.push({
                            name: actionData.name,
                            reason: 'Action with same name already exists',
                        });
                        continue;
                    }

                    // Validate action configuration using the same validation as create
                    const validatedActionData = createActionInputSchema.parse(actionData);

                    // Create the action in the database
                    let newAction = (await this.actionRepository.create({
                        name: validatedActionData.name,
                        actionType: validatedActionData.actionType,
                        triggerType: validatedActionData.triggerType,
                        config: validatedActionData.config || {},
                        schedulerConfig: validatedActionData.schedulerConfig || null,
                        enabled: validatedActionData.enabled,
                        organizationId: user.organizationId,
                    })) as unknown as ActionDefinition;

                    // If it's a scheduled job and enabled, schedule it
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
                            logger.error('Error scheduling job after action import:', schedulerError);

                            results.failed.push({
                                name: actionData.name,
                                reason: `Failed to schedule job: ${schedulerError.message}`,
                            });
                            continue;
                        }
                    }

                    results.successful.push({
                        name: newAction.name,
                        actionType: newAction.actionType,
                        triggerType: newAction.triggerType,
                        enabled: newAction.enabled,
                        id: newAction.id,
                    });
                } catch (actionError: any) {
                    results.failed.push({
                        name: actionData.name,
                        reason: actionError.message,
                    });
                }
            }

            res.status(201).json({
                message: 'Action import completed',
                summary: {
                    total: validatedData.actions.length,
                    successful: results.successful.length,
                    failed: results.failed.length,
                    skipped: results.skipped.length,
                },
                results,
            });

            await this.auditHelper.create({
                userId: user?.id || '-',
                organizationId: user?.organizationId || '-',
                action: AuditLogEnum.ACTION_IMPORTED,
                details: {
                    ip: (req as any).ipAddress,
                    info: {
                        userAgent: req.headers['user-agent'],
                        email: user?.email || '-',
                        description: `Imported actions: ${results.successful.length} successful, ${results.failed.length} failed, ${results.skipped.length} skipped`,
                        importMethod: (req as any).file
                            ? 'multer-file'
                            : req.body.file
                              ? 'base64-file'
                              : req.body.base64Data
                                ? 'base64'
                                : 'json',
                        filename: req.body.filename || 'unknown',
                        mimetype: req.body.mimetype || 'unknown',
                        importSummary: {
                            total: validatedData.actions.length,
                            successful: results.successful.length,
                            failed: results.failed.length,
                            skipped: results.skipped.length,
                        },
                    },
                },
            });
        } catch (error: any) {
            if (error instanceof z.ZodError) {
                res.status(400).json({message: 'Validation failed', details: error.flatten().fieldErrors});
                return;
            }
            logger.error('Error importing actions:', error);
            res.status(500).json({
                message: 'Failed to import actions',
                error: error.message,
            });
        }
    };
}
