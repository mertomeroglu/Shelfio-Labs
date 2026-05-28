import { Router } from 'express';
import { eslController } from '../controllers/eslController.js';
import { authenticate } from '../middlewares/authMiddleware.js';
import { requirePermission } from '../middlewares/permissionMiddleware.js';
import { requireScope } from '../middlewares/scopeMiddleware.js';
import { requireEslDeviceToken } from '../middlewares/eslDeviceTokenMiddleware.js';
import { PERMISSIONS } from '../config/permissions.js';

const router = Router();

// ESL cihazı, heartbeat ve etiket çekme isteklerini gömülü firmware ile doğrudan yapar.
// Bu iki rota auth'a takılmamalıdır; cihazın online/lastSeen güncellemesi bunlara bağlıdır.
router.get('/devices/:id/current-label', eslController.getCurrentLabel);
router.post('/devices/:id/battery', eslController.updateBattery);
router.get('/devices/:id/schedule-status', eslController.getScheduleStatus);
router.get('/settings/schedule-state', requireEslDeviceToken, eslController.getScheduleState);
router.post('/settings/bridge-schedule-sync', requireEslDeviceToken, eslController.bridgeScheduleSync);
router.get('/devices/:id/assignment-state', requireEslDeviceToken, eslController.getAssignmentState);
router.post('/devices/:id/bridge-label-sync', requireEslDeviceToken, eslController.bridgeLabelSync);
router.post('/devices/:id/render-confirm', requireEslDeviceToken, eslController.confirmRender);
router.get('/devices/:id/heartbeat-state', requireEslDeviceToken, eslController.getHeartbeatState);
router.post('/devices/:id/heartbeat', requireEslDeviceToken, eslController.updateHeartbeat);

router.use(authenticate);
router.use(requireScope());

router.get('/devices', requirePermission(PERMISSIONS.ESL_VIEW), eslController.listDevices);
router.get('/devices/:id', requirePermission(PERMISSIONS.ESL_VIEW), eslController.getDevice);
router.post('/devices', requirePermission(PERMISSIONS.ESL_UPDATE), eslController.createDevice);
router.put('/devices/:id', requirePermission(PERMISSIONS.ESL_UPDATE), eslController.updateDevice);
router.delete('/devices/:id', requirePermission(PERMISSIONS.ESL_UPDATE), eslController.deleteDevice);

router.post('/send', requirePermission(PERMISSIONS.ESL_UPDATE), eslController.sendToDevice);
router.post('/devices/:id/clear-label', requirePermission(PERMISSIONS.ESL_UPDATE), eslController.clearLabel);
router.get('/history', requirePermission(PERMISSIONS.ESL_VIEW), eslController.listHistory);
router.delete('/history', requirePermission(PERMISSIONS.ESL_UPDATE), eslController.clearHistory);
router.get('/stats', requirePermission(PERMISSIONS.ESL_VIEW), eslController.getStats);

export default router;
