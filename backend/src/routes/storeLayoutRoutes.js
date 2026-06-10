import { Router } from 'express';
import { storeLayoutController } from '../controllers/storeLayoutController.js';
import { authenticate } from '../middlewares/authMiddleware.js';
import { requirePermission } from '../middlewares/permissionMiddleware.js';
import { requireScope } from '../middlewares/scopeMiddleware.js';
import { PERMISSIONS } from '../config/permissions.js';

const router = Router();

router.use(authenticate);
router.use(requireScope());

router.get('/', requirePermission(PERMISSIONS.LAYOUT_VIEW), storeLayoutController.list);
router.get('/active', requirePermission(PERMISSIONS.LAYOUT_VIEW), storeLayoutController.getActive);
router.get('/:id', requirePermission(PERMISSIONS.LAYOUT_VIEW), storeLayoutController.getById);
router.post('/', requirePermission(PERMISSIONS.LAYOUT_MANAGE), storeLayoutController.create);
router.put('/:id', requirePermission(PERMISSIONS.LAYOUT_MANAGE), storeLayoutController.update);
router.delete('/:id', requirePermission(PERMISSIONS.LAYOUT_MANAGE), storeLayoutController.remove);
router.post('/:id/publish', requirePermission(PERMISSIONS.LAYOUT_PUBLISH), storeLayoutController.publish);
router.post('/:id/duplicate', requirePermission(PERMISSIONS.LAYOUT_MANAGE), storeLayoutController.duplicate);
router.put('/:id/items', requirePermission(PERMISSIONS.LAYOUT_MANAGE), storeLayoutController.upsertItems);

export default router;
