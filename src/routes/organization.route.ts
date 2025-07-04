import express from 'express';
import {OrganizationController} from '../controllers/organization/organization.controller';
import {isAuthenticatedGuard} from '../middlewares/is-authenticated.middleware';
import {PermissionEnum} from '../enums/rbac/permission.enum';
import {requireOrganizationAdminGuard} from '../middlewares/admin-auth.middleware';
import {userInfoMiddleware} from '../middlewares/user-info.middleware';

const router = express.Router();

// Organization management routes
router.get(
    '/',
    userInfoMiddleware,
    isAuthenticatedGuard([PermissionEnum.ORGANIZATION_READ]),
    OrganizationController.getOrganizationDetails
);

router.get(
    '/:id',
    userInfoMiddleware,
    isAuthenticatedGuard([PermissionEnum.ORGANIZATION_READ]),
    requireOrganizationAdminGuard,
    OrganizationController.getOne
);

router.put(
    '/:id',
    userInfoMiddleware,
    isAuthenticatedGuard([PermissionEnum.ORGANIZATION_WRITE]),
    requireOrganizationAdminGuard,
    OrganizationController.update
);

export default router;
