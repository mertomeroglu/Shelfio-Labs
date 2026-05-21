import { Router } from 'express';
import { authenticate } from '../middlewares/authMiddleware.js';
import { supportController } from '../controllers/supportController.js';
import { AppError } from '../utils/appError.js';
import { requirePermission } from '../middlewares/permissionMiddleware.js';
import { PERMISSIONS } from '../config/permissions.js';

const router = Router();
const WINDOW_MS = 10 * 60 * 1000;
const LIMIT_PER_WINDOW = 5;
const rateMemory = new Map();

const supportRateLimit = (req, res, next) => {
  const userId = req.user?.id || req.ip;
  const now = Date.now();
  const current = rateMemory.get(userId) || [];
  const activeWindow = current.filter((time) => now - time < WINDOW_MS);

  if (activeWindow.length >= LIMIT_PER_WINDOW) {
    next(new AppError(429, 'Cok fazla destek talebi gonderdiniz, lutfen daha sonra tekrar deneyin'));
    return;
  }

  activeWindow.push(now);
  rateMemory.set(userId, activeWindow);
  next();
};

router.post('/system-error', supportRateLimit, supportController.reportSystemError);
router.use(authenticate);
router.post('/test-mail', requirePermission(PERMISSIONS.SETTINGS_UPDATE), supportController.testMail);
router.post('/tickets', supportRateLimit, supportController.createTicket);
router.get('/tickets/:ticketId/attachments/:attachmentId', supportController.getAttachment);

export default router;
