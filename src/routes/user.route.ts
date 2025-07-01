import express from 'express';
import {UserController} from '../controllers/user/user.controller';
import {PasswordController} from '../controllers/user/password.controller';
import {TwoFactorController} from '../controllers/user/two-factor.controller';
import {isAuthenticatedGuard} from '../middlewares/is-authenticated.middleware';
import {PermissionEnum} from '../enums/rbac/permission.enum';
import {requireOrganizationAdminGuard} from '../middlewares/admin-auth.middleware';
import {userInfoMiddleware} from '../middlewares/user-info.middleware';
import multer from 'multer';

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

export default router;
