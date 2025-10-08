import express from 'express';
import {ServiceType} from '@prisma/client';
import {ServicesConfigRepository} from '../../repositories/services-config/services-config.repository';
import {UserRepository} from '../../repositories/user/user.repository';
import {AuthService} from '../../services/auth.service';
import {ServicesConfigHelper} from './helper';
import {servicesConfigSchema} from './services-config.schema';
import {ServicesConfigResponseInterface} from '../../interfaces/responses/services-config-response.interface';
import {prisma} from '../../config/db.config';
import logger from '../../config/logger';

export class ServicesConfigController {
    static servicesConfigRepository = new ServicesConfigRepository(prisma);
    static userRepository = new UserRepository(prisma);

    static getAll = async (req: express.Request, res: express.Response) => {
        try {
            const token = AuthService.decodeToken(req.cookies.token);
            const user = await this.userRepository.getOneWhere({id: token.userId});

            const awsServiceConfig = await this.servicesConfigRepository.findOneWhere({
                organizationId: user.organizationId,
                type: ServiceType.aws,
            });
            const parsedAwsServiceConfig = await ServicesConfigHelper.getAWSConfig(awsServiceConfig);

            res.json({aws: parsedAwsServiceConfig} as ServicesConfigResponseInterface);
        } catch (error: any) {
            logger.error(error);
            res.status(500).json({error: error.message});
        }
    };

    static getOne = async (req: express.Request, res: express.Response) => {
        try {
            const servicesConfig = await this.servicesConfigRepository.getOne(req.params.id);
            res.json(servicesConfig);
        } catch (error: any) {
            res.status(500).json({error: error.message});
        }
    };

    static create = async (req: express.Request, res: express.Response) => {
        try {
            const validatedData = servicesConfigSchema.parse(req.body);
            const servicesConfig = await this.servicesConfigRepository.create(validatedData);

            res.status(201).json(servicesConfig);
        } catch (error: any) {
            res.status(500).json({error: error.message});
        }
    };

    static update = async (req: express.Request, res: express.Response) => {
        try {
            const servicesConfig = await this.servicesConfigRepository.update(req.params.id, req.body);
            res.json(servicesConfig);
        } catch (error: any) {
            res.status(500).json({error: error.message});
        }
    };

    static delete = async (req: express.Request, res: express.Response) => {
        try {
            const servicesConfig = await this.servicesConfigRepository.delete(req.params.id);
            res.json(servicesConfig);
        } catch (error: any) {
            res.status(500).json({error: error.message});
        }
    };
}
