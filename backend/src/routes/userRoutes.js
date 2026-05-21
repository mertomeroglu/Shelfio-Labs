import { Router } from 'express';
import { userController } from '../controllers/userController.js';
import { authenticate } from '../middlewares/authMiddleware.js';
import { requirePermission } from '../middlewares/permissionMiddleware.js';
import { PERMISSIONS } from '../config/permissions.js';

const router = Router();

router.use(authenticate);
router.get('/', requirePermission(PERMISSIONS.USER_VIEW), userController.list);
router.get('/:id/activities', requirePermission(PERMISSIONS.USER_VIEW), userController.activities);
router.post('/', requirePermission(PERMISSIONS.USER_CREATE), userController.create);
router.put('/:id', requirePermission(PERMISSIONS.USER_UPDATE), userController.update);
router.delete('/:id', requirePermission(PERMISSIONS.USER_UPDATE), userController.remove);

export default router;
