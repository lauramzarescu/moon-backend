import express from 'express';
import {ActionsController} from '../controllers/action/action.controller';
import {isAuthenticatedGuard} from '../middlewares/is-authenticated.middleware';
import {PermissionEnum} from '../enums/rbac/permission.enum';

const router = express.Router();

router.get('/', isAuthenticatedGuard([PermissionEnum.ACTIONS_READ]), ActionsController.listActions);
router.post('/', isAuthenticatedGuard([PermissionEnum.ACTIONS_CREATE]), ActionsController.createAction);
router.get('/:id', isAuthenticatedGuard([PermissionEnum.ACTIONS_READ]), ActionsController.getAction);
router.put('/:id', isAuthenticatedGuard([PermissionEnum.ACTIONS_WRITE]), ActionsController.updateAction);
router.delete('/:id', isAuthenticatedGuard([PermissionEnum.ACTIONS_DELETE]), ActionsController.deleteAction);

export default router;
