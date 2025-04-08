import * as express from 'express';
import {prisma} from '../../config/db.config';
import {ActionRepository} from '../../repositories/action/action.repository';
import {z} from 'zod';
import {ActionDefinition, createActionInputSchema, updateActionInputSchema} from './action.schema';
import {UserRepository} from '../../repositories/user/user.repository';
import {User} from '@prisma/client';
import {AuditLogEnum} from '../../enums/audit-log/audit-log.enum';
import {AuditLogHelper} from '../audit-log/audit-log.helper';

export class ActionsController {
    static actionRepository = new ActionRepository(prisma);
    static readonly userRepository = new UserRepository(prisma);
    static readonly auditHelper = new AuditLogHelper();

    private constructor() {}

    static list = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
        try {
            const user = res.locals.user as User;
            const actions = await this.actionRepository.findMany({
                organizationId: user.organizationId,
            });

            res.json(actions);
        } catch (error) {
            console.error('Error listing actions:', error);
            res.status(500).json({error: 'List actions failed'});
        }
    };

    static get = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
        const {id} = req.params;
        try {
            const action = await this.actionRepository.findOne(id);

            if (!action) {
                res.status(404).json({error: 'Action not found'});
                return;
            }

            res.json(action);
        } catch (error) {
            console.error(`Error fetching action ${id}:`, error);
            res.status(500).json({error: 'List action failed'});
        }
    };

    static create = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
        try {
            const user = res.locals.user as User;
            const validatedData = createActionInputSchema.parse(req.body);

            const newAction = (await this.actionRepository.create({
                name: validatedData.name,
                actionType: validatedData.actionType,
                triggerType: validatedData.triggerType,
                config: validatedData.config || {},
                enabled: validatedData.enabled,
                organizationId: user.organizationId,
            })) as unknown as ActionDefinition;

            res.status(201).json(newAction);

            await this.auditHelper.create({
                userId: user?.id || '-',
                organizationId: user?.organizationId || '-',
                action: AuditLogEnum.ACTION_CREATED,
                details: {
                    ip: (req as any).ipAddress,
                    info: {
                        userAgent: req.headers['user-agent'],
                        email: user?.email || '-',
                        description: `Action ${newAction.name} created`,
                        objectNew: newAction,
                    },
                },
            });
        } catch (error) {
            if (error instanceof z.ZodError) {
                res.status(400).json({error: 'Validation failed', details: error.flatten().fieldErrors});
                return;
            }
            console.error('Error creating action:', error);
            res.status(500).json({error: 'Create action failed'});
        }
    };

    static update = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
        const {id} = req.params;

        try {
            const user = res.locals.user as User;
            const validatedData = updateActionInputSchema.parse(req.body);

            const existingAction = await this.actionRepository.findOne(id);
            if (!existingAction) {
                res.status(404).json({error: 'Action not found'});
                return;
            }

            const updatedAction = (await this.actionRepository.update(id, {
                name: validatedData.name,
                actionType: validatedData.actionType,
                triggerType: validatedData.triggerType,
                config: validatedData.config !== undefined ? validatedData.config || {} : undefined,
                enabled: validatedData.enabled,
            })) as unknown as ActionDefinition;

            res.json(updatedAction);

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
                        objectOld: existingAction,
                        objectNew: updatedAction,
                    },
                },
            });
        } catch (error) {
            if (error instanceof z.ZodError) {
                res.status(400).json({error: 'Validation failed', details: error.flatten().fieldErrors});
                return;
            }
            console.error(`Error updating action ${id}:`, error);
            res.status(500).json({error: 'Update action failed'});
        }
    };

    static delete = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
        const {id} = req.params;
        try {
            const user = res.locals.user as User;
            const existingAction = (await this.actionRepository.findOne(id)) as unknown as ActionDefinition;

            if (!existingAction) {
                res.status(404).json({error: 'Action not found'});
                return;
            }

            await this.actionRepository.delete(id);

            res.status(204).send();

            await this.auditHelper.create({
                userId: user?.id || '-',
                organizationId: user?.organizationId || '-',
                action: AuditLogEnum.ACTION_DELETED,
                details: {
                    ip: (req as any).ipAddress,
                    info: {
                        userAgent: req.headers['user-agent'],
                        email: user?.email || '-',
                        description: `Action ${existingAction.name} deleted`,
                        objectOld: existingAction,
                    },
                },
            });
        } catch (error: any) {
            console.error(`Error deleting action ${id}:`, error);
            res.status(500).json({error: 'Delete action failed'});
        }
    };
}
