import express from 'express';
import {OrganizationController} from '../controllers/organization/organization.controller';

const router = express.Router();

router.get('/', OrganizationController.getAll);
router.get('/:id', OrganizationController.getOne);
router.post('/', OrganizationController.create);
router.put('/:id', OrganizationController.update);
router.delete('/:id', OrganizationController.delete);

export default router;
