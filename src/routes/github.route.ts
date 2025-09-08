import express from 'express';
import {userInfoMiddleware} from '../middlewares/user-info.middleware';
import {isAuthenticatedGuard} from '../middlewares/is-authenticated.middleware';
import {PermissionEnum} from '../enums/rbac/permission.enum';
import {GitHubController} from '../controllers/github/github.controller';

const router = express.Router();

router.use(userInfoMiddleware);

router.get('/repositories', isAuthenticatedGuard([PermissionEnum.AWS_SERVICE_READ]), GitHubController.getRepositories);
router.get(
    '/pull-requests/:repo',
    isAuthenticatedGuard([PermissionEnum.AWS_SERVICE_READ]),
    GitHubController.getPullRequests
);
router.get(
    '/commits/:repo',
    isAuthenticatedGuard([PermissionEnum.AWS_SERVICE_READ]),
    GitHubController.getLatestCommitDefault
);
router.get(
    '/commits/:repo/:branch',
    isAuthenticatedGuard([PermissionEnum.AWS_SERVICE_READ]),
    GitHubController.getLatestCommitByBranch
);

export default router;
