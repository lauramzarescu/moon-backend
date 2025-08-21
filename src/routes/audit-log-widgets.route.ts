import express from 'express';
import {userInfoMiddleware} from '../middlewares/user-info.middleware';
import {isAuthenticatedGuard} from '../middlewares/is-authenticated.middleware';
import {PermissionEnum} from '../enums/rbac/permission.enum';
import {AuditLogWidgetsController} from '../controllers/audit-log/audit-log-widgets.controller';

const router = express.Router();

router.use(userInfoMiddleware);

router.get(
    '/deployments-count',
    isAuthenticatedGuard([PermissionEnum.AUDIT_LOG_READ]),
    AuditLogWidgetsController.deploymentsCount
);

router.get(
    '/deployments-timeline',
    isAuthenticatedGuard([PermissionEnum.AUDIT_LOG_READ]),
    AuditLogWidgetsController.deploymentsTimeline
);

export default router;
