import { Router } from 'express';
import { licenseController } from '../controllers/licenseController.js';

const router = Router();

router.post('/verify', licenseController.verify);
router.post('/session', licenseController.session);

export default router;
