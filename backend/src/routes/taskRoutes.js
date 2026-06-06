import { Router } from 'express';
import { taskController } from '../controllers/taskController.js';
import { authenticate } from '../middlewares/authMiddleware.js';
import { requirePermission } from '../middlewares/permissionMiddleware.js';
import { requireScope } from '../middlewares/scopeMiddleware.js';
import { PERMISSIONS } from '../config/permissions.js';

const router = Router();

router.use(authenticate);
router.use(requireScope());
router.get('/summary', requirePermission(PERMISSIONS.TASK_VIEW), taskController.summary);
router.get('/', requirePermission(PERMISSIONS.TASK_VIEW), taskController.list);
router.get('/:id', requirePermission(PERMISSIONS.TASK_VIEW), taskController.getById);
router.post('/', requirePermission(PERMISSIONS.TASK_CREATE), taskController.create);
router.put('/:id', requirePermission(PERMISSIONS.TASK_UPDATE), taskController.update);
router.post('/:id/comments', requirePermission(PERMISSIONS.TASK_COMMENT), taskController.addComment);
router.patch('/:id/toggle', requirePermission(PERMISSIONS.TASK_UPDATE), taskController.toggleStatus);
router.delete('/:id', requirePermission(PERMISSIONS.TASK_DELETE), taskController.remove);

export default router;
