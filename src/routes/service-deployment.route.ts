import express from 'express';
import {userInfoMiddleware} from '../middlewares/user-info.middleware';
import {isAuthenticatedGuard} from '../middlewares/is-authenticated.middleware';
import {PermissionEnum} from '../enums/rbac/permission.enum';
import {ServiceDeploymentController} from '../controllers/service-deployment/service-deployment.controller';

const router = express.Router();

router.use(userInfoMiddleware);

router.get(
    '/services/:id/latest-commit',
    isAuthenticatedGuard([PermissionEnum.AWS_SERVICE_READ]),
    ServiceDeploymentController.getLatestCommit
);
router.get(
    '/services/:id/latest-commit/:branch',
    isAuthenticatedGuard([PermissionEnum.AWS_SERVICE_READ]),
    ServiceDeploymentController.getLatestCommitByBranch
);

export default router;
