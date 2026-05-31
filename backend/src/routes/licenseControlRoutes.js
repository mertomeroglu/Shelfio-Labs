import { Router } from 'express';
import { licenseControlController } from '../controllers/licenseControlController.js';

const router = Router();

router.get('/health', licenseControlController.health);

export default router;
