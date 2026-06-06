import { Router } from 'express';
import { warehouseController } from '../controllers/warehouseController.js';
import { authenticate } from '../middlewares/authMiddleware.js';
import { requirePermission } from '../middlewares/permissionMiddleware.js';
import { requireScope } from '../middlewares/scopeMiddleware.js';
import { PERMISSIONS } from '../config/permissions.js';

const router = Router();

router.use(authenticate);
router.use(requireScope());

router.get('/locations', requirePermission(PERMISSIONS.STOCK_VIEW), warehouseController.listLocations);
router.get('/summary', requirePermission(PERMISSIONS.STOCK_VIEW), warehouseController.getSummary);
router.get('/movements', requirePermission(PERMISSIONS.STOCK_VIEW), warehouseController.listMovements);
router.post('/movements', requirePermission(PERMISSIONS.STOCK_UPDATE), warehouseController.createMovement);
router.patch('/locations/:id', requirePermission(PERMISSIONS.STOCK_UPDATE), warehouseController.updateLocation);

export default router;
