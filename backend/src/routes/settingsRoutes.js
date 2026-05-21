import { Router } from 'express';
import { settingsController } from '../controllers/settingsController.js';
import { authenticate } from '../middlewares/authMiddleware.js';
import { requirePermission } from '../middlewares/permissionMiddleware.js';
import { requireScope } from '../middlewares/scopeMiddleware.js';
import { PERMISSIONS } from '../config/permissions.js';

const router = Router();

router.post('/developer-logs/public', settingsController.ingestPublicDeveloperLog);

router.use(authenticate);
router.use(requireScope());
router.get('/', requirePermission(PERMISSIONS.SETTINGS_VIEW), settingsController.get);
router.get('/login-activities', requirePermission(PERMISSIONS.SETTINGS_UPDATE), settingsController.loginActivities);
router.get('/audit-logs', requirePermission(PERMISSIONS.SETTINGS_UPDATE), settingsController.auditLogs);
router.get('/audit-logs/export', requirePermission(PERMISSIONS.SETTINGS_UPDATE), settingsController.exportAuditLogs);
router.post('/developer-logs', settingsController.ingestDeveloperLog);
router.get('/developer-logs', requirePermission(PERMISSIONS.SETTINGS_UPDATE), settingsController.developerLogs);
router.get('/developer-logs/export', requirePermission(PERMISSIONS.SETTINGS_UPDATE), settingsController.exportDeveloperLogs);
router.delete('/logs/:type', requirePermission(PERMISSIONS.SETTINGS_UPDATE), settingsController.clearLogs);
router.get('/logistics-tariffs', requirePermission(PERMISSIONS.SETTINGS_VIEW), settingsController.logisticsTariffs);
router.put('/logistics-tariffs', requirePermission(PERMISSIONS.SETTINGS_UPDATE), settingsController.updateLogisticsTariffs);
router.post('/logistics-quote', requirePermission(PERMISSIONS.SETTINGS_VIEW), settingsController.logisticsQuote);
router.post('/test-mail', requirePermission(PERMISSIONS.SETTINGS_UPDATE), settingsController.testMail);
router.put('/', requirePermission(PERMISSIONS.SETTINGS_UPDATE), settingsController.update);
router.post('/verify-pin', settingsController.verifyPin);
router.patch('/system-desk-pin', requirePermission(PERMISSIONS.SETTINGS_UPDATE), settingsController.updateSystemDeskPin);

export default router;
