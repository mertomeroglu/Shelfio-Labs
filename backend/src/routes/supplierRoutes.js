import { Router } from 'express';
import { supplierController } from '../controllers/supplierController.js';
import { authenticate } from '../middlewares/authMiddleware.js';
import { requirePermission } from '../middlewares/permissionMiddleware.js';
import { requireScope } from '../middlewares/scopeMiddleware.js';
import { PERMISSIONS } from '../config/permissions.js';

const router = Router();

router.use(authenticate);
router.use(requireScope());
router.get('/', requirePermission(PERMISSIONS.SUPPLIER_VIEW), supplierController.list);
router.get('/:id', requirePermission(PERMISSIONS.SUPPLIER_VIEW), supplierController.getById);
router.post('/', requirePermission(PERMISSIONS.SUPPLIER_CREATE), supplierController.create);
router.put('/:id', requirePermission(PERMISSIONS.SUPPLIER_UPDATE), supplierController.update);
router.delete('/:id', requirePermission(PERMISSIONS.SUPPLIER_DELETE), supplierController.remove);

export default router;