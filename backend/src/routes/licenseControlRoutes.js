import { Router } from 'express';
import { licenseControlController } from '../controllers/licenseControlController.js';

const router = Router();

router.get('/health', licenseControlController.health);
router.get('/tenants/:externalTenantId/usage', licenseControlController.tenantUsage);
router.post('/exports', licenseControlController.createExport);
router.get('/exports/download/:downloadToken', licenseControlController.downloadExport);
router.get('/exports/:jobId/status', licenseControlController.exportStatus);

export default router;
