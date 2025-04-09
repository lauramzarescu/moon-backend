import {ClustersController} from '../controllers/aws/clusters.controller';
import {ServicesController} from '../controllers/aws/services.controller';
import express from 'express';
import {userInfoMiddleware} from '../middlewares/user-info.middleware';
import {isAuthenticatedGuard} from '../middlewares/is-authenticated.middleware';
import {PermissionEnum} from '../enums/rbac/permission.enum';

const router = express.Router();

const servicesController = new ServicesController();
const clustersController = new ClustersController();

router.use(userInfoMiddleware);

router.get('/clusters', isAuthenticatedGuard([PermissionEnum.AWS_CLUSTER_READ]), clustersController.getClusters);

router.put(
    '/services/desired-count',
    isAuthenticatedGuard([PermissionEnum.AWS_SERVICE_WRITE]),
    servicesController.updateServiceDesiredCount
);

router.put(
    '/services/container-image',
    isAuthenticatedGuard([PermissionEnum.AWS_SERVICE_WRITE]),
    servicesController.updateServiceContainerImage
);

router.post(
    '/services/restart',
    isAuthenticatedGuard([PermissionEnum.AWS_SERVICE_WRITE]),
    servicesController.restartService
);

export default router;
