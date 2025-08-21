import express from 'express';
import {latestCommitByBranchParamSchema, serviceArnParamSchema} from './service-deployment.schema';
import {ServiceRepositoryMappingRepository} from '../../repositories/service-repository/service-repository-mapping.repository';
import {prisma} from '../../config/db.config';
import {GitHubService} from '../../services/github.service';
import logger from '../../config/logger';

export class ServiceDeploymentController {
    static repo = new ServiceRepositoryMappingRepository(prisma);

    static getLatestCommit = async (req: express.Request, res: express.Response) => {
        try {
            const {id} = serviceArnParamSchema.parse(req.params);

            const organizationId = res.locals.user?.organizationId as string | undefined;
            if (!organizationId) {
                res.status(400).json({message: 'Organization context missing'});
                return;
            }

            const link = await this.repo.getOneWhere({id, organizationId});
            const commit = await GitHubService.getLatestCommit(link.repo, link.owner);

            res.json(commit);
        } catch (error: any) {
            logger.error('Error in getLatestCommit', error);
            res.status(500).json({message: error?.message || 'Failed to get latest commit'});
        }
    };

    static getLatestCommitByBranch = async (req: express.Request, res: express.Response) => {
        try {
            const {id, branch} = latestCommitByBranchParamSchema.parse(req.params);
            const organizationId = res.locals.user?.organizationId as string | undefined;

            if (!organizationId) {
                res.status(400).json({message: 'Organization context missing'});
                return;
            }

            const link = await this.repo.getOneWhere({id, organizationId});
            const commit = await GitHubService.getLatestCommit(link.repo, link.owner, branch);

            res.json(commit);
        } catch (error: any) {
            logger.error('Error in getLatestCommitByBranch', error);
            res.status(500).json({message: error?.message || 'Failed to get latest commit'});
        }
    };
}
