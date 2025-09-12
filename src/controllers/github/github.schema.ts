import {z} from 'zod';

export const githubBranchSchema = z.object({
    name: z.string(),
    commit: z.object({
        sha: z.string(),
        url: z.string(),
    }),
});

export const githubPullRequestUserSchema = z.object({
    login: z.string().nullable(),
    avatar_url: z.string().nullable(),
});

export const githubPullRequestRefSchema = z.object({
    ref: z.string(),
    sha: z.string(),
});

export const githubPullRequestSchema = z.object({
    id: z.number(),
    number: z.number(),
    title: z.string(),
    head: githubPullRequestRefSchema,
    base: githubPullRequestRefSchema,
    state: z.literal('open'),
    created_at: z.string(),
    updated_at: z.string(),
    html_url: z.string(),
    user: githubPullRequestUserSchema,
});

export const githubRepositorySchema = z.object({
    id: z.number(),
    name: z.string(),
    full_name: z.string(),
    private: z.boolean(),
    owner: z.string().nullable(),
    default_branch: z.string(),
    html_url: z.string(),
});

export const githubCommitInfoSchema = z.object({
    sha: z.string(),
    message: z.string(),
    authorName: z.string().nullable(),
    authorEmail: z.string().nullable(),
    date: z.string().nullable(),
    url: z.string(),
});

export const fetchBranchesResponseSchema = z.object({
    openPullRequests: z.array(githubPullRequestSchema),
    branches: z.array(githubBranchSchema),
});

export type GitHubBranch = z.infer<typeof githubBranchSchema>;
export type GitHubPullRequest = z.infer<typeof githubPullRequestSchema>;
export type GitHubPullRequestUser = z.infer<typeof githubPullRequestUserSchema>;
export type GitHubPullRequestRef = z.infer<typeof githubPullRequestRefSchema>;
export type GitHubRepository = z.infer<typeof githubRepositorySchema>;
export type GitHubCommitInfo = z.infer<typeof githubCommitInfoSchema>;
export type FetchBranchesResponse = z.infer<typeof fetchBranchesResponseSchema>;
