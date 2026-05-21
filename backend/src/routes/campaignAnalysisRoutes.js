import { Router } from 'express';
import { campaignAnalysisController } from '../controllers/campaignAnalysisController.js';
import { authenticate } from '../middlewares/authMiddleware.js';
import { requirePermission } from '../middlewares/permissionMiddleware.js';
import { requireScope } from '../middlewares/scopeMiddleware.js';
import { PERMISSIONS } from '../config/permissions.js';

const router = Router();

router.use(authenticate);
router.use(requireScope());
router.get('/suggestions', requirePermission(PERMISSIONS.REPORT_VIEW), campaignAnalysisController.suggestions);
router.post('/simulate', requirePermission(PERMISSIONS.REPORT_VIEW), campaignAnalysisController.simulate);

export default router;
