import { Router } from 'express';
import { authenticate } from '../middlewares/authMiddleware.js';
import { requirePermission } from '../middlewares/permissionMiddleware.js';
import { requireScope } from '../middlewares/scopeMiddleware.js';
import { accessRequestController } from '../controllers/accessRequestController.js';
import { PERMISSIONS } from '../config/permissions.js';

const router = Router();

router.use(authenticate, requireScope());
router.post('/', requirePermission(PERMISSIONS.ACCESS_REQUEST_CREATE), accessRequestController.create);
router.get('/', requirePermission(PERMISSIONS.ACCESS_REQUEST_VIEW_OWN), accessRequestController.list);
router.post('/bulk', requirePermission(PERMISSIONS.ACCESS_REQUEST_APPROVE), accessRequestController.bulk);
router.post('/:id/approve', requirePermission(PERMISSIONS.ACCESS_REQUEST_APPROVE), accessRequestController.approve);
router.post('/:id/reject', requirePermission(PERMISSIONS.ACCESS_REQUEST_REJECT), accessRequestController.reject);
router.post('/:id/extend', requirePermission(PERMISSIONS.ACCESS_REQUEST_APPROVE), accessRequestController.extend);

export default router;
