import express from 'express';
import {SamlController} from '../controllers/saml/saml.controller';
import {isAuthenticatedGuard} from '../middlewares/is-authenticated.middleware';
import {PermissionEnum} from '../enums/rbac/permission.enum';
import {userInfoMiddleware} from '../middlewares/user-info.middleware';

const router = express.Router();

router.use(userInfoMiddleware);

router.get('/', isAuthenticatedGuard([PermissionEnum.SAML_CONFIGURATION_READ]), SamlController.getConfiguration);

router.post('/', isAuthenticatedGuard([PermissionEnum.SAML_CONFIGURATION_CREATE]), SamlController.createConfiguration);

router.put('/:id', isAuthenticatedGuard([PermissionEnum.SAML_CONFIGURATION_WRITE]), SamlController.updateConfiguration);

router.delete(
    '/:id',
    isAuthenticatedGuard([PermissionEnum.SAML_CONFIGURATION_DELETE]),
    SamlController.deleteConfiguration
);

router.post(
    '/2fa/:id',
    isAuthenticatedGuard([PermissionEnum.SAML_CONFIGURATION_DELETE]),
    SamlController.delete2FAConfiguration
);

export default router;
