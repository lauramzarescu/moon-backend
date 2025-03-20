import {ClustersController} from '../controllers/aws/clusters.controller';
import {ServicesController} from '../controllers/aws/services.controller';
import express from "express";

const router = express.Router();

const servicesController = new ServicesController();
const clustersController = new ClustersController();

router.get('/clusters', clustersController.getClusters);

router.put('/services/desired-count', servicesController.updateServiceDesiredCount);

export default router;