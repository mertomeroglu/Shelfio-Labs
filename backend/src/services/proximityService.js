import { getPrisma } from '../providers/postgresProvider.js';
import { AppError } from '../utils/appError.js';
import { notificationRuleEngine } from './proximity/notificationRuleEngine.js';

const ALLOWED_EVENT_TYPES = new Set(['ZONE_ENTER', 'ZONE_EXIT', 'DWELL']);
const EVENT_TYPE_ALIASES = new Map([
  ['ZONE_STAY', 'DWELL'],
  ['STAY', 'DWELL'],
  ['DWELL', 'DWELL'],
  ['ZONE_STAY_CHECK', 'DWELL'],
]);
const DEFAULT_EVENT_TYPE = 'ZONE_ENTER';
const DEFAULT_SOURCE = 'WEBVIEW_BRIDGE';

const normalizeText = (value) => String(value || '').trim();
const normalizeUpper = (value) => normalizeText(value).toUpperCase();

const parseNullableInt = (value, fieldName) => {
  if (value === undefined || value === null || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new AppError(400, `${fieldName} sayısal olmalıdır`, { errorCode: 'INVALID_PROXIMITY_PAYLOAD' });
  }
  return Math.trunc(numeric);
};

const parseRssi = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new AppError(400, 'RSSI sayısal olmalıdır', { errorCode: 'INVALID_RSSI' });
  }
  return Math.trunc(numeric);
};

const parseEventType = (value) => {
  const rawEventType = normalizeUpper(value || DEFAULT_EVENT_TYPE);
  const eventType = EVENT_TYPE_ALIASES.get(rawEventType) || rawEventType;
  if (!ALLOWED_EVENT_TYPES.has(eventType)) {
    throw new AppError(400, 'Geçersiz proximity event tipi', { errorCode: 'INVALID_EVENT_TYPE' });
  }
  return eventType;
};

const parseDetectedAt = (value) => {
  const raw = normalizeText(value);
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new AppError(400, 'detectedAt geçerli bir ISO tarih olmalıdır', { errorCode: 'INVALID_DETECTED_AT' });
  }
  return date;
};

const validateAndNormalizePayload = (payload = {}) => {
  const deviceCode = normalizeText(payload.deviceId || payload.deviceCode);
  const uuid = normalizeText(payload.uuid);
  const major = parseNullableInt(payload.major, 'major');
  const minor = parseNullableInt(payload.minor, 'minor');
  const rssi = parseRssi(payload.rssi);
  const eventType = parseEventType(payload.eventType || payload.checkType);
  const source = normalizeUpper(payload.source || DEFAULT_SOURCE) || DEFAULT_SOURCE;
  const detectedAt = parseDetectedAt(payload.detectedAt);

  const hasDeviceCode = Boolean(deviceCode);
  const hasUuidTuple = Boolean(uuid) && major !== null && minor !== null;
  if (!hasDeviceCode && !hasUuidTuple) {
    throw new AppError(400, 'deviceId veya uuid+major+minor bilgisi zorunludur', {
      errorCode: 'MISSING_BEACON_IDENTITY',
    });
  }

  return {
    deviceCode,
    uuid,
    major,
    minor,
    rssi,
    eventType,
    source,
    detectedAt,
    rawPayload: payload && typeof payload === 'object' ? payload : {},
  };
};

const findBeaconDevice = async ({ deviceCode, uuid, major, minor }) => {
  const prisma = await getPrisma();
  const or = [];

  if (deviceCode) {
    or.push({ deviceCode });
    or.push({ id: deviceCode });
  }

  if (uuid && major !== null && minor !== null) {
    or.push({ uuid, major, minor });
  }

  if (!or.length) return null;

  return prisma.beaconDevice.findFirst({
    where: { OR: or },
    orderBy: [{ updatedAt: 'desc' }],
  });
};

const getLocationZone = async (locationZoneId) => {
  if (!locationZoneId) return null;
  const prisma = await getPrisma();
  return prisma.locationZone.findUnique({
    where: { id: locationZoneId },
    include: {
      section: {
        select: { id: true, name: true, number: true },
      },
    },
  });
};

const createProximityEvent = async ({ actor, input, beaconDevice, locationZone }) => {
  const prisma = await getPrisma();
  const userId = actor?.id || 'anonymous';
  const userType = actor?.userType || 'anonymous';
  return prisma.proximityEvent.create({
    data: {
      userId,
      userType,
      beaconDeviceId: beaconDevice?.id || null,
      locationZoneId: locationZone?.id || beaconDevice?.locationZoneId || null,
      deviceCode: input.deviceCode || beaconDevice?.deviceCode || null,
      uuid: input.uuid || beaconDevice?.uuid || null,
      major: input.major ?? beaconDevice?.major ?? null,
      minor: input.minor ?? beaconDevice?.minor ?? null,
      rssi: input.rssi,
      eventType: input.eventType,
      source: input.source,
      detectedAt: input.detectedAt,
      rawPayload: input.rawPayload,
    },
  });
};

const updateBeaconLastSeen = async (beaconDevice) => {
  if (!beaconDevice?.id) return null;
  const prisma = await getPrisma();
  return prisma.beaconDevice.update({
    where: { id: beaconDevice.id },
    data: { lastSeenAt: new Date() },
  });
};

const toResponse = ({
  eventId,
  eventRecorded = false,
  shouldNotify = false,
  reason = null,
  notification = null,
  dedupeUntil = null,
  productId = null,
  barcode = null,
  productName = null,
  dedupeKey = null,
}) => {
  const response = {
    success: true,
    eventRecorded,
    shouldNotify,
  };
  if (eventId) response.eventId = eventId;
  if (notification) response.notification = notification;
  if (!shouldNotify && reason) response.reason = reason;
  if (!shouldNotify && dedupeUntil) response.dedupeUntil = dedupeUntil;
  if (productId) response.productId = productId;
  if (barcode) response.barcode = barcode;
  if (productName) response.productName = productName;
  if (dedupeKey) response.dedupeKey = dedupeKey;
  return response;
};

export const proximityService = {
  async recordEvent(payload = {}, actor = null) {
    // 1. Validate & normalize payload (throws AppError on bad input)
    const input = validateAndNormalizePayload(payload);

    // 2. Beacon lookup & lastSeen update
    const matchedBeacon = await findBeaconDevice(input);
    const beaconDevice = matchedBeacon ? await updateBeaconLastSeen(matchedBeacon) : null;
    const locationZone = await getLocationZone(beaconDevice?.locationZoneId);

    // 3. Always create ProximityEvent record (diagnostic log)
    const proximityEvent = await createProximityEvent({
      actor,
      input,
      beaconDevice,
      locationZone,
    });

    // 4. If no authenticated actor, record event but skip notification
    if (!actor?.id) {
      return toResponse({ eventId: proximityEvent.id, eventRecorded: true, reason: 'NOT_AUTHENTICATED' });
    }

    // 5. Non-customer actor: record event but skip notification
    if (actor.userType !== 'customer') {
      return toResponse({ eventId: proximityEvent.id, eventRecorded: true, reason: 'CUSTOMER_ONLY_FEATURE' });
    }

    // 6. Beacon not found in system
    if (!beaconDevice) {
      return toResponse({ eventId: proximityEvent.id, eventRecorded: true, reason: 'UNKNOWN_BEACON' });
    }

    // 7. Beacon inactive
    if (normalizeUpper(beaconDevice.status || 'ACTIVE') !== 'ACTIVE') {
      return toResponse({ eventId: proximityEvent.id, eventRecorded: true, reason: 'UNKNOWN_BEACON' });
    }

    // 8. Zone checks
    if (locationZone && locationZone.isActive === false) {
      return toResponse({ eventId: proximityEvent.id, eventRecorded: true, reason: 'NO_MATCHING_ZONE' });
    }

    if (!locationZone && !beaconDevice.locationZoneId && !beaconDevice.sectionId) {
      return toResponse({ eventId: proximityEvent.id, eventRecorded: true, reason: 'NO_MATCHING_ZONE' });
    }

    // 9. Notification rule evaluation (only for authenticated customers)
    const evaluation = await notificationRuleEngine.evaluate({
      userId: actor.id,
      userType: actor.userType,
      proximityEvent,
      beaconDevice,
      locationZone,
    });

    return toResponse({
      eventId: proximityEvent.id,
      eventRecorded: true,
      shouldNotify: Boolean(evaluation.shouldNotify),
      reason: evaluation.reason || null,
      notification: evaluation.notification || null,
      dedupeUntil: evaluation.dedupeUntil || null,
      productId: evaluation.productId || null,
      barcode: evaluation.barcode || null,
      productName: evaluation.productName || null,
      dedupeKey: evaluation.dedupeKey || null,
    });
  },
};
