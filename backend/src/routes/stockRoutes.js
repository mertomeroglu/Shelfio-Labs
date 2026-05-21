import { Router } from 'express';
import { stockController } from '../controllers/stockController.js';
import { authenticate } from '../middlewares/authMiddleware.js';
import { requirePermission } from '../middlewares/permissionMiddleware.js';
import { requireScope } from '../middlewares/scopeMiddleware.js';
import { PERMISSIONS } from '../config/permissions.js';

const router = Router();

router.use(authenticate);
router.use(requireScope());
router.get('/', requirePermission(PERMISSIONS.STOCK_VIEW), stockController.getStocks);
router.get('/expiry/expired-notifications/dry-run', requirePermission(PERMISSIONS.STOCK_VIEW), stockController.expiredBatchNotificationDryRun);
router.post('/expiry/expired-notifications/run', requirePermission(PERMISSIONS.STOCK_UPDATE), stockController.runExpiredBatchNotifications);
router.get('/expired-batches', requirePermission(PERMISSIONS.STOCK_VIEW), stockController.expiredBatchWarnings);
router.post('/expired-batches/dispose', requirePermission(PERMISSIONS.STOCK_UPDATE), stockController.disposeExpiredBatches);
router.get('/movements/summary', requirePermission(PERMISSIONS.STOCK_VIEW), stockController.movementsSummary);
router.get('/movements', requirePermission(PERMISSIONS.STOCK_VIEW), stockController.listMovements);
router.post('/movements/:id/cancel', requirePermission(PERMISSIONS.STOCK_UPDATE), stockController.cancelMovement);
router.put('/products/:productId/batches', requirePermission(PERMISSIONS.STOCK_UPDATE), stockController.upsertBatch);
router.post('/in', requirePermission(PERMISSIONS.STOCK_UPDATE), stockController.stockIn);
router.post('/out', requirePermission(PERMISSIONS.STOCK_UPDATE), stockController.stockOut);
router.post('/adjust', requirePermission(PERMISSIONS.STOCK_UPDATE), stockController.adjustStock);
router.post('/transfer', requirePermission(PERMISSIONS.STOCK_UPDATE), stockController.transferStock);

export default router;
