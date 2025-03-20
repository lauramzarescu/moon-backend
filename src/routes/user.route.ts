import express from 'express';
import {UserController} from '../controllers/user/user.controller';
import {isAuthenticatedGuard} from "../middlewares/is-authenticated.middleware";
import {PermissionEnum} from "../enums/rbac/permission.enum";
import {requireOrganizationAdminGuard} from "../middlewares/admin-auth.middleware";

const router = express.Router();

router.get('/',
    isAuthenticatedGuard([PermissionEnum.USER_READ]),
    UserController.getAll
);

router.get('/me', isAuthenticatedGuard([PermissionEnum.USER_READ]), UserController.getUserDetails);

router.get('/:id', isAuthenticatedGuard([PermissionEnum.USER_READ]), requireOrganizationAdminGuard, UserController.getOne);

router.post('/', isAuthenticatedGuard([PermissionEnum.USER_CREATE]), UserController.create);

router.put('/:id', isAuthenticatedGuard([PermissionEnum.USER_WRITE]), UserController.update);

router.delete('/:id', isAuthenticatedGuard([PermissionEnum.USER_DELETE]), UserController.delete);

router.post('/change-password', isAuthenticatedGuard([PermissionEnum.USER_READ]), UserController.changePassword);

router.post('/2fa/change-password', isAuthenticatedGuard([PermissionEnum.USER_READ]), UserController.changePasswordWith2FA);

// 2FA routes
router.get('/2fa/status', isAuthenticatedGuard([PermissionEnum.USER_READ]), UserController.get2FAStatus);
router.post('/2fa/setup', isAuthenticatedGuard([PermissionEnum.USER_READ]), UserController.setup2FA);
router.post('/2fa/verify-session', UserController.verifySession2FA);
router.post('/2fa/verify', isAuthenticatedGuard([PermissionEnum.USER_READ]), UserController.verify2FACode);
router.post('/2fa/disable', isAuthenticatedGuard([PermissionEnum.USER_READ]), UserController.disable2FA);

export default router;
