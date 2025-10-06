import express from 'express';
import {ActionsController} from '../controllers/action/action.controller';
import {isAuthenticatedGuard} from '../middlewares/is-authenticated.middleware';
import {PermissionEnum} from '../enums/rbac/permission.enum';
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

router.use(userInfoMiddleware);

/**
 * Execute on each page refresh. It will execute the actions triggered by page_refresh type.
 */
router.get(
    '/refresh',
    userInfoMiddleware,
    isAuthenticatedGuard([PermissionEnum.ACTIONS_READ]),
    ActionsController.refresh
);

/**
 * Export actions as JSON file
 */
router.get(
    '/export',
    isAuthenticatedGuard([PermissionEnum.ACTIONS_READ]),
    upload.single('file'),
    ActionsController.exportActions
);

/**
 * Import actions from JSON file or data
 */
router.post('/import', isAuthenticatedGuard([PermissionEnum.ACTIONS_CREATE]), ActionsController.importActions);

router.get('/', isAuthenticatedGuard([PermissionEnum.ACTIONS_READ]), ActionsController.list);
router.post('/', isAuthenticatedGuard([PermissionEnum.ACTIONS_CREATE]), ActionsController.create);
router.get('/:id', isAuthenticatedGuard([PermissionEnum.ACTIONS_READ]), ActionsController.get);
router.put('/:id', isAuthenticatedGuard([PermissionEnum.ACTIONS_WRITE]), ActionsController.update);
router.delete('/:id', isAuthenticatedGuard([PermissionEnum.ACTIONS_DELETE]), ActionsController.delete);

export default router;
