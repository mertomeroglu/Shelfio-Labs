import { Router } from 'express';
import { authenticate } from '../middlewares/authMiddleware.js';
import { notificationController } from '../controllers/notificationController.js';
import { requirePermission } from '../middlewares/permissionMiddleware.js';
import { PERMISSIONS } from '../config/permissions.js';

const router = Router();

router.use(authenticate);
router.post('/broadcast', requirePermission(PERMISSIONS.NOTIFICATION_MANAGE), notificationController.create);
router.get('/', requirePermission(PERMISSIONS.NOTIFICATION_VIEW), notificationController.list);
router.get('/summary', requirePermission(PERMISSIONS.NOTIFICATION_VIEW), notificationController.summary);
router.get('/analytics', requirePermission(PERMISSIONS.NOTIFICATION_VIEW), notificationController.analytics);
router.patch('/read-all', requirePermission(PERMISSIONS.NOTIFICATION_VIEW), notificationController.markAllAsRead);
router.delete('/', requirePermission(PERMISSIONS.NOTIFICATION_MANAGE), notificationController.removeMany);
router.post('/mute-type', requirePermission(PERMISSIONS.NOTIFICATION_MANAGE), notificationController.muteType);
router.post('/:id/action', requirePermission(PERMISSIONS.NOTIFICATION_VIEW), notificationController.trackAction);
router.post('/:id/snooze', requirePermission(PERMISSIONS.NOTIFICATION_MANAGE), notificationController.snooze);
router.post('/:id/mute', requirePermission(PERMISSIONS.NOTIFICATION_MANAGE), notificationController.mute);
router.patch('/:id/read', requirePermission(PERMISSIONS.NOTIFICATION_VIEW), notificationController.markAsRead);

export default router;
