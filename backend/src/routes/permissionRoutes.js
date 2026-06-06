import { Router } from 'express';
import { authenticate } from '../middlewares/authMiddleware.js';
import { requirePermission } from '../middlewares/permissionMiddleware.js';
import { permissionController } from '../controllers/permissionController.js';
import { PERMISSIONS } from '../config/permissions.js';

const router = Router();

router.use(authenticate);
router.get('/me/effective', requirePermission(PERMISSIONS.PERMISSION_EFFECTIVE_VIEW), permissionController.meEffective);

export default router;
