import express from 'express';
import {userInfoMiddleware} from '../middlewares/user-info.middleware';
import {isAuthenticatedGuard} from '../middlewares/is-authenticated.middleware';
import {PermissionEnum} from '../enums/rbac/permission.enum';
import {ServiceRepositoryController} from '../controllers/service-repository/service-repository.controller';

const router = express.Router();

router.use(userInfoMiddleware);

router.post(
    '/repository',
    isAuthenticatedGuard([PermissionEnum.AWS_SERVICE_WRITE]),
    ServiceRepositoryController.linkRepository
);
router.get(
    '/repositories',
    isAuthenticatedGuard([PermissionEnum.AWS_SERVICE_READ]),
    ServiceRepositoryController.getAllLinkedRepositories
);
router.get(
    '/:id/repository',
    isAuthenticatedGuard([PermissionEnum.AWS_SERVICE_READ]),
    ServiceRepositoryController.getLinkedRepository
);
router.delete(
    '/:id/repository',
    isAuthenticatedGuard([PermissionEnum.AWS_SERVICE_WRITE]),
    ServiceRepositoryController.unlinkRepository
);

export default router;
