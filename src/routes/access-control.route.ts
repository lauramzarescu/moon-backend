import {Router} from 'express';
import {AccessControlController} from '../controllers/access-control/access-control.controller';
import {isAuthenticatedGuard} from "../middlewares/is-authenticated.middleware";
import {PermissionEnum} from "../enums/rbac/permission.enum";

const router = Router();
const controller = new AccessControlController();

router.post('/', isAuthenticatedGuard([PermissionEnum.ACCESS_CONTROL_WRITE]), controller.addToList);

router.delete('/:id', isAuthenticatedGuard([PermissionEnum.ACCESS_CONTROL_DELETE]), controller.removeFromList);

router.get('/', isAuthenticatedGuard([PermissionEnum.ACCESS_CONTROL_READ]), controller.getList);

router.post('/disable', isAuthenticatedGuard([PermissionEnum.ACCESS_CONTROL_WRITE]), controller.disableAccessControl);

export default router;
