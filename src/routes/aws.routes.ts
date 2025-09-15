import {ClustersController} from '../controllers/aws/clusters.controller';
import {ServicesController} from '../controllers/aws/services.controller';
import {EnvironmentVariableController} from '../controllers/aws/environment-variable.controller';
import express from 'express';
import {userInfoMiddleware} from '../middlewares/user-info.middleware';
import {isAuthenticatedGuard} from '../middlewares/is-authenticated.middleware';
import {PermissionEnum} from '../enums/rbac/permission.enum';

const router = express.Router();

const servicesController = new ServicesController();
const clustersController = new ClustersController();
const environmentVariableController = new EnvironmentVariableController();

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

router.post(
    '/services/environment-variables',
    isAuthenticatedGuard([PermissionEnum.AWS_SERVICE_WRITE]),
    environmentVariableController.addEnvironmentVariables
);

router.put(
    '/services/environment-variables',
    isAuthenticatedGuard([PermissionEnum.AWS_SERVICE_WRITE]),
    environmentVariableController.editEnvironmentVariables
);

router.delete(
    '/services/environment-variables',
    isAuthenticatedGuard([PermissionEnum.AWS_SERVICE_WRITE]),
    environmentVariableController.removeEnvironmentVariables
);

// Versioning endpoints
router.get(
    '/services/environment-variables/versions',
    isAuthenticatedGuard([PermissionEnum.AWS_SERVICE_READ]),
    environmentVariableController.getVersionsList
);

router.get(
    '/services/environment-variables/version',
    isAuthenticatedGuard([PermissionEnum.AWS_SERVICE_READ]),
    environmentVariableController.getVariablesFromVersion
);

router.post(
    '/services/environment-variables/copy',
    isAuthenticatedGuard([PermissionEnum.AWS_SERVICE_WRITE]),
    environmentVariableController.copyVariablesBetweenServices
);

router.post(
    '/services/environment-variables/move',
    isAuthenticatedGuard([PermissionEnum.AWS_SERVICE_WRITE]),
    environmentVariableController.moveVariablesBetweenServices
);

router.post(
    '/services/environment-variables/rollback',
    isAuthenticatedGuard([PermissionEnum.AWS_SERVICE_WRITE]),
    environmentVariableController.rollbackToVersion
);

router.get(
    '/services/environment-variables/compare',
    isAuthenticatedGuard([PermissionEnum.AWS_SERVICE_READ]),
    environmentVariableController.compareVersions
);

// router.put(
//     '/services/environment-variables/replace',
//     isAuthenticatedGuard([PermissionEnum.AWS_SERVICE_WRITE]),
//     environmentVariableController.replaceEnvironmentVariables
// );
//
// router.put(
//     '/services/environment-variables/bulk-update',
//     isAuthenticatedGuard([PermissionEnum.AWS_SERVICE_WRITE]),
//     environmentVariableController.bulkUpdateEnvironmentVariables
// );

export default router;
