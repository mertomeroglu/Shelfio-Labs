import { Router } from 'express';
import { authenticate } from '../middlewares/authMiddleware.js';
import { requirePermission } from '../middlewares/permissionMiddleware.js';
import { temporaryGrantController } from '../controllers/temporaryGrantController.js';
import { PERMISSIONS } from '../config/permissions.js';

const router = Router();

router.use(authenticate);
router.post('/:id/revoke', requirePermission(PERMISSIONS.TEMP_GRANT_REVOKE), temporaryGrantController.revoke);

export default router;
