import { Router } from 'express';
import { procurementController } from '../controllers/procurementController.js';
import { authenticate } from '../middlewares/authMiddleware.js';
import { requirePermission } from '../middlewares/permissionMiddleware.js';
import { requireScope } from '../middlewares/scopeMiddleware.js';
import { PERMISSIONS } from '../config/permissions.js';

const router = Router();

router.use(authenticate);
router.use(requireScope());

router.get('/logistics-tariffs', requirePermission(PERMISSIONS.PROCUREMENT_VIEW), procurementController.listLogisticsTariffs);
router.post('/logistics-quote', requirePermission(PERMISSIONS.PROCUREMENT_VIEW), procurementController.getLogisticsQuote);

router.get('/supplier-products', requirePermission(PERMISSIONS.PROCUREMENT_VIEW), procurementController.listSupplierProducts);
router.post('/supplier-products', requirePermission(PERMISSIONS.PROCUREMENT_CREATE), procurementController.createSupplierProduct);
router.put('/supplier-products/:id', requirePermission(PERMISSIONS.PROCUREMENT_UPDATE), procurementController.updateSupplierProduct);
router.delete('/supplier-products/:id', requirePermission(PERMISSIONS.PROCUREMENT_UPDATE), procurementController.removeSupplierProduct);

router.post('/suggestions/generate', requirePermission(PERMISSIONS.PROCUREMENT_CREATE), procurementController.generateSuggestions);
router.get('/suggestions', requirePermission(PERMISSIONS.PROCUREMENT_VIEW), procurementController.listSuggestions);
router.patch('/suggestions/:id', requirePermission(PERMISSIONS.PROCUREMENT_UPDATE), procurementController.updateSuggestion);
router.post('/suggestions/:id/approve', requirePermission(PERMISSIONS.PROCUREMENT_APPROVE), procurementController.approveSuggestion);
router.post('/suggestions/:id/reject', requirePermission(PERMISSIONS.PROCUREMENT_APPROVE), procurementController.rejectSuggestion);

router.get('/orders', requirePermission(PERMISSIONS.PROCUREMENT_VIEW), procurementController.listOrders);
router.post('/orders', requirePermission(PERMISSIONS.PROCUREMENT_CREATE), procurementController.createOrder);
router.get('/orders/:id/items', requirePermission(PERMISSIONS.PROCUREMENT_VIEW), procurementController.listOrderItems);
router.patch('/orders/:id/status', requirePermission(PERMISSIONS.PROCUREMENT_APPROVE), procurementController.updateOrderStatus);

router.get('/catalog-imports', requirePermission(PERMISSIONS.PROCUREMENT_VIEW), procurementController.listCatalogImports);
router.get('/catalog-approval-queue', requirePermission(PERMISSIONS.PROCUREMENT_VIEW), procurementController.listCatalogApprovalQueue);
router.post('/catalog-approval-queue/:rowId/match', requirePermission(PERMISSIONS.PROCUREMENT_APPROVE), procurementController.matchCatalogApprovalQueueRow);
router.post('/catalog-approval-queue/:rowId/create-draft', requirePermission(PERMISSIONS.PROCUREMENT_APPROVE), procurementController.createCatalogApprovalQueueDraft);
router.post('/catalog-approval-queue/:rowId/reject', requirePermission(PERMISSIONS.PROCUREMENT_APPROVE), procurementController.rejectCatalogApprovalQueueRow);
router.post('/catalog-approval-queue/:rowId/undo', requirePermission(PERMISSIONS.PROCUREMENT_APPROVE), procurementController.undoCatalogApprovalQueueDecision);
router.post('/catalog-imports/preview', requirePermission(PERMISSIONS.PROCUREMENT_CREATE), procurementController.previewCatalogImport);
router.patch('/catalog-imports/:id/rows/:rowId', requirePermission(PERMISSIONS.PROCUREMENT_UPDATE), procurementController.updateCatalogImportRow);
router.post('/catalog-imports/:id/commit', requirePermission(PERMISSIONS.PROCUREMENT_APPROVE), procurementController.commitCatalogImport);
router.get('/catalog-versions', requirePermission(PERMISSIONS.PROCUREMENT_VIEW), procurementController.listCatalogVersions);
router.get('/catalog-versions/:versionId/rows', requirePermission(PERMISSIONS.PROCUREMENT_VIEW), procurementController.getCatalogVersionRows);
router.post('/catalog-versions/:versionId/activate', requirePermission(PERMISSIONS.PROCUREMENT_APPROVE), procurementController.activateCatalogVersion);

export default router;
