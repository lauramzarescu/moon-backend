import express from 'express';
import {GitHubService} from '../../services/github.service';
import {z} from 'zod';
import logger from '../../config/logger';
import {fetchBranchesResponseSchema} from './github.schema';

export class GitHubController {
    static getRepositories = async (req: express.Request, res: express.Response) => {
        try {
            const org = (req.query.org as string) || undefined;
            const repos = await GitHubService.fetchRepositories(org);

            res.json(repos);
        } catch (error: any) {
            logger.error('Error in getRepositories', error);
            res.status(500).json({message: error?.message || 'Failed to get repositories'});
        }
    };

    static getPullRequests = async (req: express.Request, res: express.Response) => {
        try {
            const paramsSchema = z.object({
                repo: z.string().min(1),
            });
            const {repo} = paramsSchema.parse(req.params);
            const result = await GitHubService.fetchPullRequests(repo);

            // Validate the response against our schema
            const validatedResult = fetchBranchesResponseSchema.parse(result);

            res.json(validatedResult);
        } catch (error: any) {
            logger.error('Error in getBranches', error);
            res.status(500).json({message: error?.message || 'Failed to get branches and pull requests'});
        }
    };

    static getLatestCommitDefault = async (req: express.Request, res: express.Response) => {
        try {
            const paramsSchema = z.object({
                repo: z.string().min(1),
            });
            const {repo} = paramsSchema.parse(req.params);
            const commit = await GitHubService.getLatestCommit(repo);

            res.json(commit);
        } catch (error: any) {
            logger.error('Error in getLatestCommitDefault', error);
            res.status(500).json({message: error?.message || 'Failed to get latest commit'});
        }
    };

    static getLatestCommitByBranch = async (req: express.Request, res: express.Response) => {
        try {
            const paramsSchema = z.object({
                repo: z.string().min(1),
                branch: z.string().min(1),
            });
            const {repo, branch} = paramsSchema.parse(req.params);
            const commit = await GitHubService.getLatestCommit(repo, undefined, branch);

            res.json(commit);
        } catch (error: any) {
            logger.error('Error in getLatestCommitByBranch', error);
            res.status(500).json({message: error?.message || 'Failed to get latest commit'});
        }
    };
}
