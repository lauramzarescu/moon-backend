import axios, {AxiosInstance} from 'axios';
import logger from '../config/logger';
import {FetchBranchesResponse, GitHubPullRequest, GitHubRepository} from '../controllers/github/github.schema';

export interface GitHubCommitInfo {
    sha: string;
    message: string;
    authorName: string | null;
    authorEmail: string | null;
    date: string | null; // ISO string
    url: string;
}

export class GitHubService {
    private static client: AxiosInstance;

    private static getClient(): AxiosInstance {
        if (!this.client) {
            const token = process.env.GITHUB_ACCESS_TOKEN;
            if (!token) {
                logger.warn('GITHUB_ACCESS_TOKEN is not set. GitHub API calls will fail.');
            }

            this.client = axios.create({
                baseURL: 'https://api.github.com',
                headers: {
                    Accept: 'application/vnd.github+json',
                    ...(token ? {Authorization: `Bearer ${token}`} : {}),
                    'X-GitHub-Api-Version': '2022-11-28',
                },
                timeout: 10000,
            });
        }

        return this.client;
    }

    static async fetchRepositories(org?: string): Promise<GitHubRepository[]> {
        try {
            const client = this.getClient();
            const url = org ? `/orgs/${encodeURIComponent(org)}/repos` : '/user/repos';
            const {data} = await client.get(url, {
                params: {
                    per_page: 1000,
                    sort: 'updated',
                },
            });

            return data.map(
                (r: any): GitHubRepository => ({
                    id: r.id,
                    name: r.name,
                    full_name: r.full_name,
                    private: r.private,
                    owner: r.owner?.login,
                    default_branch: r.default_branch,
                    html_url: r.html_url,
                })
            );
        } catch (error: any) {
            logger.error('Failed to fetch GitHub repositories', error);
            throw new Error(
                error?.response?.data?.message ||
                    error?.message ||
                    'Failed to fetch GitHub repositories from GitHub API'
            );
        }
    }

    static async fetchPullRequests(repo: string, owner = process.env.GITHUB_OWNER): Promise<FetchBranchesResponse> {
        try {
            if (!owner) {
                throw new Error('GITHUB_OWNER is not set');
            }

            const client = this.getClient();
            const pullRequestsResponse = await client.get(
                `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`,
                {
                    params: {
                        state: 'open',
                        per_page: 1000,
                    },
                }
            );

            const openPullRequests: GitHubPullRequest[] = pullRequestsResponse.data.map(
                (pr: any): GitHubPullRequest => ({
                    id: pr.id,
                    number: pr.number,
                    title: pr.title,
                    head: {
                        ref: pr.head.ref,
                        sha: pr.head.sha,
                    },
                    base: {
                        ref: pr.base.ref,
                        sha: pr.base.sha,
                    },
                    state: pr.state as 'open',
                    created_at: pr.created_at,
                    updated_at: pr.updated_at,
                    html_url: pr.html_url,
                    user: {
                        login: pr.user?.login || null,
                        avatar_url: pr.user?.avatar_url || null,
                    },
                })
            );

            return {
                openPullRequests,
            };
        } catch (error: any) {
            logger.error('Failed to fetch GitHub branches and pull requests', error);
            throw new Error(
                error?.response?.data?.message ||
                    error?.message ||
                    'Failed to fetch GitHub branches and pull requests from GitHub API'
            );
        }
    }

    static async getLatestCommit(
        repo: string,
        owner = process.env.GITHUB_OWNER,
        branch = process.env.GITHUB_DEFAULT_BRANCH
    ): Promise<GitHubCommitInfo> {
        try {
            if (!owner) {
                throw new Error('GITHUB_OWNER is not set');
            }

            const client = this.getClient();
            const {data} = await client.get(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits`, {
                params: {sha: branch, per_page: 1},
            });
            const commit = Array.isArray(data) ? data[0] : data;

            if (!commit) {
                throw new Error('No commits found');
            }

            return {
                sha: commit.sha,
                message: commit.commit?.message || '',
                authorName: commit.commit?.author?.name || null,
                authorEmail: commit.commit?.author?.email || null,
                date: commit.commit?.author?.date || null,
                url: commit.html_url,
            };
        } catch (error: any) {
            logger.error('Failed to fetch latest GitHub commit', error?.response?.data || error?.message || error);
            throw new Error(error?.response?.data?.message || error?.message || 'Failed to fetch latest commit');
        }
    }
}
