import { Router } from 'express';
import { ssoController } from '../controllers/ssoController.js';

const router = Router();

router.post('/exchange', ssoController.exchange);

export default router;
