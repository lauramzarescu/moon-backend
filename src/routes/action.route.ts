import express from 'express';
import {ActionsController} from '../controllers/action/action.controller';
import {isAuthenticatedGuard} from '../middlewares/is-authenticated.middleware';
import {PermissionEnum} from '../enums/rbac/permission.enum';

const router = express.Router();

router.get('/', isAuthenticatedGuard([PermissionEnum.ACTIONS_READ]), ActionsController.list);
router.post('/', isAuthenticatedGuard([PermissionEnum.ACTIONS_CREATE]), ActionsController.create);
router.get('/:id', isAuthenticatedGuard([PermissionEnum.ACTIONS_READ]), ActionsController.get);
router.put('/:id', isAuthenticatedGuard([PermissionEnum.ACTIONS_WRITE]), ActionsController.update);
router.delete('/:id', isAuthenticatedGuard([PermissionEnum.ACTIONS_DELETE]), ActionsController.delete);

export default router;
