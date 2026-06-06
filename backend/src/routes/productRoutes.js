import { Router } from 'express';
import { productController } from '../controllers/productController.js';
import { authenticate } from '../middlewares/authMiddleware.js';
import { requirePermission } from '../middlewares/permissionMiddleware.js';
import { requireScope } from '../middlewares/scopeMiddleware.js';
import { PERMISSIONS } from '../config/permissions.js';

const router = Router();

router.use(authenticate);
router.use(requireScope());
router.get('/', requirePermission(PERMISSIONS.PRODUCT_VIEW), productController.list);
router.get('/barcode/:barcode', requirePermission(PERMISSIONS.PRODUCT_VIEW), productController.findByBarcode);
router.get('/:id', requirePermission(PERMISSIONS.PRODUCT_VIEW), productController.getById);
router.post('/', requirePermission(PERMISSIONS.PRODUCT_CREATE), productController.create);
router.put('/:id', requirePermission(PERMISSIONS.PRODUCT_UPDATE), productController.update);
router.delete('/:id', requirePermission(PERMISSIONS.PRODUCT_DELETE), productController.remove);

export default router;