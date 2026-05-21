import { Router } from 'express';
import { posController } from '../controllers/posController.js';
import { authenticate } from '../middlewares/authMiddleware.js';
import { requirePermission } from '../middlewares/permissionMiddleware.js';
import { requireScope } from '../middlewares/scopeMiddleware.js';
import { PERMISSIONS } from '../config/permissions.js';

const router = Router();

router.use(authenticate);
router.use(requireScope());

router.get('/desks/activation-status', requirePermission(PERMISSIONS.POS_VIEW), posController.getDeskActivationStatus);
router.patch('/desks/activation-status', requirePermission(PERMISSIONS.POS_DESK_MANAGE), posController.setDeskActivation);

router.get('/dashboard', requirePermission(PERMISSIONS.POS_VIEW), posController.getDashboard);
router.get('/categories', requirePermission(PERMISSIONS.POS_VIEW), posController.getCategories);
router.get('/categories/:categoryId/products', requirePermission(PERMISSIONS.POS_VIEW), posController.getProductsByCategory);
router.get('/products/search', requirePermission(PERMISSIONS.POS_VIEW), posController.searchProducts);
router.get('/products/by-barcode/:barcode', requirePermission(PERMISSIONS.POS_VIEW), posController.findByBarcode);
router.post('/sales/automatic', requirePermission(PERMISSIONS.SETTINGS_UPDATE), posController.createAutomaticSale);
router.post('/sales', requirePermission(PERMISSIONS.POS_SALE), posController.completeSale);
router.post('/returns', requirePermission(PERMISSIONS.POS_RETURN), posController.processReturn);
router.get('/sales/today', requirePermission(PERMISSIONS.POS_VIEW), posController.getTodaySales);
router.get('/sales/all', requirePermission(PERMISSIONS.POS_VIEW), posController.getAllSales);
router.get('/sales/reference/:ref', requirePermission(PERMISSIONS.POS_VIEW), posController.getSaleByReference);
router.get('/sales/:id', requirePermission(PERMISSIONS.POS_VIEW), posController.getSaleById);
router.get('/report/daily', requirePermission(PERMISSIONS.POS_VIEW), posController.getDailyReport);

export default router;
