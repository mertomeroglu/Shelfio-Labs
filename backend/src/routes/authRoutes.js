import { Router } from 'express';
import { authController } from '../controllers/authController.js';
import { authenticate } from '../middlewares/authMiddleware.js';
import { requirePermission } from '../middlewares/permissionMiddleware.js';
import { PERMISSIONS } from '../config/permissions.js';

const router = Router();

router.post('/login', authController.login);
router.post('/refresh', authController.refresh);
router.get('/me', authenticate, authController.me);
router.post('/register', authenticate, requirePermission(PERMISSIONS.USER_CREATE), authController.register);

export default router;
