import { Router } from 'express';
import { categoryController } from '../controllers/categoryController.js';
import { authenticate } from '../middlewares/authMiddleware.js';
import { requirePermission } from '../middlewares/permissionMiddleware.js';
import { requireScope } from '../middlewares/scopeMiddleware.js';
import { PERMISSIONS } from '../config/permissions.js';

const router = Router();

router.use(authenticate);
router.use(requireScope());
router.get('/', requirePermission(PERMISSIONS.CATEGORY_VIEW), categoryController.list);
router.get('/labels', requirePermission(PERMISSIONS.CATEGORY_VIEW), categoryController.listLabels);
router.post('/labels/sync', requirePermission(PERMISSIONS.CATEGORY_UPDATE), categoryController.syncLabels);
router.get('/:id', requirePermission(PERMISSIONS.CATEGORY_VIEW), categoryController.getById);
router.post('/', requirePermission(PERMISSIONS.CATEGORY_CREATE), categoryController.create);
router.put('/:id', requirePermission(PERMISSIONS.CATEGORY_UPDATE), categoryController.update);
router.delete('/:id', requirePermission(PERMISSIONS.CATEGORY_DELETE), categoryController.remove);

export default router;
