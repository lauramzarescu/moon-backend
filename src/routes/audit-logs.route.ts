import express from 'express';
import {isAuthenticatedGuard} from '../middlewares/is-authenticated.middleware';
import {PermissionEnum} from '../enums/rbac/permission.enum';
import {userInfoMiddleware} from '../middlewares/user-info.middleware';
import {AuditLogController} from '../controllers/audit-log/audit-log.controller';

const router = express.Router();

router.get(
    '/',
    userInfoMiddleware,
    isAuthenticatedGuard([PermissionEnum.AUDIT_LOG_READ]),
    AuditLogController.getAllPaginated
);

export default router;
