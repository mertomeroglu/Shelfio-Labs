import { Router } from 'express';
import { authenticate } from '../middlewares/authMiddleware.js';
import { requirePermission } from '../middlewares/permissionMiddleware.js';
import { PERMISSIONS } from '../config/permissions.js';
import { customerController } from '../controllers/customerController.js';

const router = Router();
router.use(authenticate);
router.get('/', requirePermission(PERMISSIONS.USER_VIEW), customerController.list);
router.get('/gift-cards/available', requirePermission(PERMISSIONS.USER_VIEW), customerController.availableGiftCards);
router.post('/', requirePermission(PERMISSIONS.USER_CREATE), customerController.create);
router.get('/:id', requirePermission(PERMISSIONS.USER_VIEW), customerController.detail);
router.patch('/:id/status', requirePermission(PERMISSIONS.USER_UPDATE), customerController.setStatus);
router.post('/:id/gift-cards', requirePermission(PERMISSIONS.USER_UPDATE), customerController.assignGiftCard);
router.post('/gift-cards/bulk-assign', requirePermission(PERMISSIONS.USER_UPDATE), customerController.assignGiftCardBulk);
router.post('/:id/discounts', requirePermission(PERMISSIONS.USER_UPDATE), customerController.assignDiscount);
router.post('/notifications/send', requirePermission(PERMISSIONS.NOTIFICATION_MANAGE), customerController.sendNotification);
export default router;
