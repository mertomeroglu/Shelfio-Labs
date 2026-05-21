import { Router } from 'express';
import { reportController } from '../controllers/reportController.js';
import { authenticate } from '../middlewares/authMiddleware.js';
import { requirePermission } from '../middlewares/permissionMiddleware.js';
import { requireScope } from '../middlewares/scopeMiddleware.js';
import { PERMISSIONS } from '../config/permissions.js';

const router = Router();

router.use(authenticate);
router.use(requireScope());
router.get('/pricing-analysis/summary', requirePermission(PERMISSIONS.REPORT_VIEW), reportController.pricingAnalysisSummary);
router.post('/pricing-analysis/sell-price/calculate', requirePermission(PERMISSIONS.REPORT_VIEW), reportController.calculateSellPriceRecommendation);
router.post('/pricing-analysis/sell-price/approve', requirePermission(PERMISSIONS.REPORT_VIEW), reportController.approveSellPriceRecommendation);
router.get('/pricing-analysis/rows', requirePermission(PERMISSIONS.REPORT_VIEW), reportController.pricingAnalysisRows);
router.get('/pricing-analysis/rows/:productId', requirePermission(PERMISSIONS.REPORT_VIEW), reportController.pricingAnalysisDetail);
router.get('/pricing-analysis', requirePermission(PERMISSIONS.REPORT_VIEW), reportController.pricingAnalysis);
router.get('/dashboard', requirePermission(PERMISSIONS.REPORT_VIEW), reportController.dashboard);
router.get('/day-end', requirePermission(PERMISSIONS.REPORT_VIEW), reportController.dayEnd);
router.post('/day-end/run', requirePermission(PERMISSIONS.REPORT_EXPORT), reportController.runDayEnd);
router.get('/summary', requirePermission(PERMISSIONS.REPORT_VIEW), reportController.summary);
router.get('/sections/:section', requirePermission(PERMISSIONS.REPORT_VIEW), reportController.section);
router.get('/export-xlsx', requirePermission(PERMISSIONS.REPORT_EXPORT), reportController.exportXlsx);
router.get('/search', requirePermission(PERMISSIONS.REPORT_VIEW), reportController.globalSearch);
router.get('/last-update', requirePermission(PERMISSIONS.REPORT_VIEW), reportController.lastStockUpdate);

export default router;
