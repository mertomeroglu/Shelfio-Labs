import { Router } from 'express';
import { sectionController } from '../controllers/sectionController.js';
import { authenticate } from '../middlewares/authMiddleware.js';
import { requirePermission } from '../middlewares/permissionMiddleware.js';
import { requireScope } from '../middlewares/scopeMiddleware.js';
import { PERMISSIONS } from '../config/permissions.js';

const router = Router();

router.use(authenticate);
router.use(requireScope());
router.get('/', requirePermission(PERMISSIONS.SECTION_VIEW), sectionController.list);
router.get('/transfer-requests', requirePermission(PERMISSIONS.TRANSFER_REQUEST_VIEW), sectionController.listTransferRequests);
router.post('/transfer-requests/bulk-status', requirePermission(PERMISSIONS.TRANSFER_REQUEST_MANAGE), sectionController.bulkUpdateTransferRequests);
router.post('/transfer-requests/automation/run', requirePermission(PERMISSIONS.TRANSFER_REQUEST_MANAGE), sectionController.runTransferAutomationScan);
router.patch('/transfer-requests/:requestId/status', requirePermission(PERMISSIONS.TRANSFER_REQUEST_MANAGE), sectionController.updateTransferRequestStatus);
router.get('/:id', requirePermission(PERMISSIONS.SECTION_VIEW), sectionController.getById);
router.get('/:id/products', requirePermission(PERMISSIONS.SECTION_VIEW), sectionController.getProducts);
router.post('/:id/transfer-requests', requirePermission(PERMISSIONS.TRANSFER_REQUEST_CREATE), sectionController.createTransferRequest);
router.post('/', requirePermission(PERMISSIONS.SECTION_CREATE), sectionController.create);
router.put('/:id', requirePermission(PERMISSIONS.SECTION_UPDATE), sectionController.update);
router.delete('/:id', requirePermission(PERMISSIONS.SECTION_DELETE), sectionController.remove);

export default router;
