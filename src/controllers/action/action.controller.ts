import * as express from 'express';
import {prisma} from '../../config/db.config';
import {ActionRepository} from '../../repositories/action/action.repository';
import {z} from 'zod';
import {createActionInputSchema, updateActionInputSchema} from './action.schema';
import {AuthService} from '../../services/auth.service';
import {UserRepository} from '../../repositories/user/user.repository';

export class ActionsController {
    static actionRepository = new ActionRepository(prisma);
    static readonly userRepository = new UserRepository(prisma);

    private constructor() {}

    static list = async (req: express.Request, res: express.Response, next: express.NextFunction) => {
        try {
            const token = AuthService.decodeToken(req.headers.authorization);
            const user = await this.userRepository.getOneWhere({id: token.userId});

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
            const token = AuthService.decodeToken(req.headers.authorization);
            const user = await this.userRepository.getOneWhere({id: token.userId});

            const validatedData = createActionInputSchema.parse(req.body);

            const newAction = await this.actionRepository.create({
                name: validatedData.name,
                actionType: validatedData.actionType,
                triggerType: validatedData.triggerType,
                config: validatedData.config || {},
                enabled: validatedData.enabled,
                organizationId: user.organizationId,
            });

            res.status(201).json(newAction);
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
            const validatedData = updateActionInputSchema.parse(req.body);

            const existingAction = await this.actionRepository.findOne(id);
            if (!existingAction) {
                res.status(404).json({error: 'Action not found'});
                return;
            }

            const updatedAction = await this.actionRepository.update(id, {
                name: validatedData.name,
                actionType: validatedData.actionType,
                triggerType: validatedData.triggerType,
                config: validatedData.config !== undefined ? validatedData.config || {} : undefined,
                enabled: validatedData.enabled,
            });

            res.json(updatedAction);
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
            const existingAction = await this.actionRepository.findOne(id);
            if (!existingAction) {
                res.status(404).json({error: 'Action not found'});
                return;
            }

            await this.actionRepository.delete(id);

            res.status(204).send();
        } catch (error: any) {
            console.error(`Error deleting action ${id}:`, error);
            res.status(500).json({error: 'Delete action failed'});
        }
    };
}
