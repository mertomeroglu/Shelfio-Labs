import { Router } from 'express';
import { PERMISSIONS } from '../config/permissions.js';
import { proximityController } from '../controllers/proximityController.js';
import { authenticateProximityActor } from '../middlewares/proximityAuthMiddleware.js';
import { requirePermission } from '../middlewares/permissionMiddleware.js';

const router = Router();
const requireProximityView = requirePermission(PERMISSIONS.PROXIMITY_VIEW);
const requireProximityBeaconManage = requirePermission(PERMISSIONS.PROXIMITY_BEACONS_MANAGE);
const requireProximityZoneManage = requirePermission(PERMISSIONS.PROXIMITY_ZONES_MANAGE);
const requireProximityRuleManage = requirePermission(PERMISSIONS.PROXIMITY_RULES_MANAGE);
const requireProximityLogsView = requirePermission(PERMISSIONS.PROXIMITY_LOGS_VIEW);

router.use(authenticateProximityActor);
router.post('/events', proximityController.createEvent);

router.get('/beacons', requireProximityView, proximityController.listBeacons);
router.post('/beacons', requireProximityBeaconManage, proximityController.createBeacon);
router.patch('/beacons/:id', requireProximityBeaconManage, proximityController.updateBeacon);
router.patch('/beacons/:id/status', requireProximityBeaconManage, proximityController.updateBeaconStatus);
router.delete('/beacons/:id', requireProximityBeaconManage, proximityController.deleteBeacon);

router.get('/zones', requireProximityView, proximityController.listZones);
router.post('/zones', requireProximityZoneManage, proximityController.createZone);
router.patch('/zones/:id', requireProximityZoneManage, proximityController.updateZone);

router.get('/rules', requireProximityView, proximityController.listRules);
router.post('/rules', requireProximityRuleManage, proximityController.createRule);
router.patch('/rules/:id', requireProximityRuleManage, proximityController.updateRule);
router.patch('/rules/:id/status', requireProximityRuleManage, proximityController.updateRuleStatus);

router.get('/events', requireProximityLogsView, proximityController.listEvents);
router.get('/deliveries', requireProximityLogsView, proximityController.listDeliveries);

export default router;
