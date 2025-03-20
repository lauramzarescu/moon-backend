import express from 'express';
import {ServicesConfigController} from '../controllers/services-config/services-config.controller';

const router = express.Router();

router.get('/', ServicesConfigController.getAll);
router.get('/:id', ServicesConfigController.getOne);
router.post('/', ServicesConfigController.create);
router.put('/:id', ServicesConfigController.update);
router.delete('/:id', ServicesConfigController.delete);

export default router;
