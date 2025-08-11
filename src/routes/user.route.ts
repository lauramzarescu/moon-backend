import express from 'express';
import {UserController} from '../controllers/user/user.controller';
import {PasswordController} from '../controllers/user/password.controller';
import {TwoFactorController} from '../controllers/user/two-factor.controller';
import {isAuthenticatedGuard} from '../middlewares/is-authenticated.middleware';
import {PermissionEnum} from '../enums/rbac/permission.enum';
import {requireOrganizationAdminGuard} from '../middlewares/admin-auth.middleware';
import {userInfoMiddleware} from '../middlewares/user-info.middleware';
import multer from 'multer';
import {WebauthnController} from '../controllers/user/webauthn.controller';

const router = express.Router();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB limit
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/json' || file.originalname.endsWith('.json')) {
            cb(null, true);
        } else {
            cb(new Error('Only JSON files are allowed'));
        }
    },
});

// User management routes
router.get('/', isAuthenticatedGuard([PermissionEnum.USER_READ]), UserController.getAll);
router.get('/me', userInfoMiddleware, isAuthenticatedGuard([PermissionEnum.USER_READ]), UserController.getUserDetails);
router.get(
    '/devices',
    userInfoMiddleware,
    isAuthenticatedGuard([PermissionEnum.USER_READ]),
    UserController.getAuthorizedDevices
);
router.get(
    '/:id',
    isAuthenticatedGuard([PermissionEnum.USER_READ]),
    requireOrganizationAdminGuard,
    UserController.getOne
);
router.post('/', userInfoMiddleware, isAuthenticatedGuard([PermissionEnum.USER_CREATE]), UserController.create);
router.post(
    '/invitation',
    userInfoMiddleware,
    isAuthenticatedGuard([PermissionEnum.USER_CREATE]),
    UserController.createByInvitation
);
router.put('/:id', userInfoMiddleware, isAuthenticatedGuard([PermissionEnum.USER_WRITE]), UserController.update);
router.delete(
    '/:id',
    userInfoMiddleware,
    isAuthenticatedGuard([PermissionEnum.USER_DELETE]),
    requireOrganizationAdminGuard,
    UserController.delete
);
router.delete(
    '/devices/:id',
    userInfoMiddleware,
    isAuthenticatedGuard([PermissionEnum.USER_READ]),
    requireOrganizationAdminGuard,
    UserController.removeAuthorizedDevice
);

// Import/Export routes
router.get(
    '/export/json',
    userInfoMiddleware,
    isAuthenticatedGuard([PermissionEnum.USER_READ]),
    requireOrganizationAdminGuard,
    upload.single('file'),
    UserController.exportUsers
);
router.post(
    '/import/json',
    userInfoMiddleware,
    isAuthenticatedGuard([PermissionEnum.USER_CREATE]),
    requireOrganizationAdminGuard,
    UserController.importUsers
);

// Password management routes
router.get(
    '/change-password/2fa-status',
    userInfoMiddleware,
    isAuthenticatedGuard([PermissionEnum.USER_READ]),
    PasswordController.getPasswordChange2FAStatus
);
router.post(
    '/change-password',
    userInfoMiddleware,
    isAuthenticatedGuard([PermissionEnum.USER_READ]),
    PasswordController.changePassword
);
router.post(
    '/2fa/change-password',
    userInfoMiddleware,
    isAuthenticatedGuard([PermissionEnum.USER_READ]),
    PasswordController.changePasswordWith2FA
);
router.post(
    '/webauthn/change-password/start',
    userInfoMiddleware,
    isAuthenticatedGuard([PermissionEnum.USER_READ]),
    PasswordController.startPasswordChangeWebAuthn
);
router.post(
    '/webauthn/change-password/complete',
    userInfoMiddleware,
    isAuthenticatedGuard([PermissionEnum.USER_READ]),
    PasswordController.changePasswordWithWebAuthn
);
router.post('/forgot-password', PasswordController.forgotPassword);
router.post('/reset-password', PasswordController.resetPassword);
router.post(
    '/admin/reset-password/:id',
    userInfoMiddleware,
    isAuthenticatedGuard([PermissionEnum.USER_WRITE]),
    requireOrganizationAdminGuard,
    PasswordController.adminResetPassword
);

// 2FA routes
router.get(
    '/2fa/status',
    userInfoMiddleware,
    isAuthenticatedGuard([PermissionEnum.USER_READ]),
    TwoFactorController.get2FAStatus
);
router.post(
    '/2fa/setup',
    userInfoMiddleware,
    isAuthenticatedGuard([PermissionEnum.USER_READ]),
    TwoFactorController.setup2FA
);
router.post('/2fa/verify-session', TwoFactorController.verifySession2FA);
router.post(
    '/2fa/verify',
    userInfoMiddleware,
    isAuthenticatedGuard([PermissionEnum.USER_READ]),
    TwoFactorController.verify2FACode
);
router.post(
    '/2fa/disable',
    userInfoMiddleware,
    isAuthenticatedGuard([PermissionEnum.USER_READ]),
    TwoFactorController.disable2FA
);
router.post('/admin/2fa/reset/:id', userInfoMiddleware, TwoFactorController.adminReset2FAForUser);
router.post('/2fa/reset/confirm/:token', TwoFactorController.confirm2FAReset);

router.post(
    '/2fa/yubikey/setup',
    userInfoMiddleware,
    isAuthenticatedGuard([PermissionEnum.USER_READ]),
    TwoFactorController.setupYubikey
);
router.post('/2fa/yubikey/verify', TwoFactorController.verifyYubikey);
router.get(
    '/2fa/yubikey/list',
    userInfoMiddleware,
    isAuthenticatedGuard([PermissionEnum.USER_READ]),
    TwoFactorController.getUserYubikeys
);
router.delete(
    '/2fa/yubikey/:id',
    userInfoMiddleware,
    isAuthenticatedGuard([PermissionEnum.USER_READ]),
    TwoFactorController.removeYubikey
);
router.put(
    '/2fa/yubikey/update',
    userInfoMiddleware,
    isAuthenticatedGuard([PermissionEnum.USER_READ]),
    TwoFactorController.updateYubikey
);
router.post(
    '/2fa/method',
    userInfoMiddleware,
    isAuthenticatedGuard([PermissionEnum.USER_READ]),
    TwoFactorController.setTwoFactorMethod
);

// WebAuthn routes
router.post(
    '/2fa/webauthn/registration/start',
    userInfoMiddleware,
    isAuthenticatedGuard([PermissionEnum.USER_READ]),
    WebauthnController.startWebAuthnRegistration
);
router.post(
    '/2fa/webauthn/registration/complete',
    userInfoMiddleware,
    isAuthenticatedGuard([PermissionEnum.USER_READ]),
    WebauthnController.completeWebAuthnRegistration
);
router.post('/2fa/webauthn/authentication/start', WebauthnController.startWebAuthnAuthentication);
router.post('/2fa/webauthn/authentication/complete', WebauthnController.completeWebAuthnAuthentication);

// WebAuthn re-authentication routes (for already authenticated users)
router.post(
    '/2fa/webauthn/start',
    userInfoMiddleware,
    isAuthenticatedGuard([PermissionEnum.USER_READ]),
    WebauthnController.startWebAuthnReAuthentication
);
router.post(
    '/2fa/webauthn/complete',
    userInfoMiddleware,
    isAuthenticatedGuard([PermissionEnum.USER_READ]),
    WebauthnController.completeWebAuthnReAuthentication
);

export default router;
