import express from 'express';
import {linkRepositoryBodySchema, linkRepositoryParamsSchema} from './service-repository.schema';
import {ServiceRepositoryMappingRepository} from '../../repositories/service-repository/service-repository-mapping.repository';
import {prisma} from '../../config/db.config';
import logger from '../../config/logger';

export class ServiceRepositoryController {
    static serviceRepository = new ServiceRepositoryMappingRepository(prisma);

    static linkRepository = async (req: express.Request, res: express.Response) => {
        try {
            const {repo, serviceArn} = linkRepositoryBodySchema.parse(req.body);
            const organizationId = res.locals.user?.organizationId as string | undefined;
            const owner = process.env.GITHUB_OWNER;

            if (!owner) {
                res.status(400).json({message: 'GITHUB_OWNER is not set'});
                return;
            }

            if (!organizationId) {
                res.status(400).json({message: 'Organization context missing'});
                return;
            }

            const record = await this.serviceRepository.upsert(
                {serviceArn, owner, repo, organizationId},
                {organizationId_serviceArn: {serviceArn, organizationId}}
            );

            res.status(201).json(record);
        } catch (error: any) {
            logger.error('Error linking repository', error);
            res.status(500).json({message: error?.message || 'Failed to link repository'});
        }
    };

    static getLinkedRepository = async (req: express.Request, res: express.Response) => {
        try {
            const {id} = linkRepositoryParamsSchema.parse(req.params);
            const organizationId = res.locals.user?.organizationId as string | undefined;

            if (!organizationId) {
                res.status(400).json({message: 'Organization context missing'});
                return;
            }

            const record = await this.serviceRepository.getOneWhere({id, organizationId});

            res.json(record);
        } catch (error: any) {
            logger.error('Error getting linked repository', error);
            res.status(404).json({message: error?.message || 'Linked repository not found'});
        }
    };

    static getAllLinkedRepositories = async (req: express.Request, res: express.Response) => {
        try {
            const organizationId = res.locals.user?.organizationId as string | undefined;

            if (!organizationId) {
                res.status(400).json({message: 'Organization context missing'});
                return;
            }

            const records = await this.serviceRepository.findMany({organizationId});

            res.json(records);
        } catch (error: any) {
            logger.error('Error getting all linked repositories', error);
            res.status(500).json({message: error?.message || 'Failed to fetch linked repositories'});
        }
    };

    static unlinkRepository = async (req: express.Request, res: express.Response) => {
        try {
            const {id} = linkRepositoryParamsSchema.parse(req.params);
            const organizationId = res.locals.user?.organizationId as string | undefined;

            if (!organizationId) {
                res.status(400).json({message: 'Organization context missing'});
                return;
            }

            const record = await this.serviceRepository.deleteOne({id} as any);

            res.json(record);
        } catch (error: any) {
            logger.error('Error unlinking repository', error);
            res.status(500).json({message: error?.message || 'Failed to unlink repository'});
        }
    };
}
