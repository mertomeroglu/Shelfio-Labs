import { proximityService } from '../services/proximityService.js';
import { getPrisma } from '../providers/postgresProvider.js';
import { AppError, createNotFoundError } from '../utils/appError.js';

const normalizeText = (value) => String(value || '').trim();
const normalizeUpper = (value) => normalizeText(value).toUpperCase();
const toNullableInt = (value, fieldName) => {
  if (value === undefined || value === null || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) throw new AppError(400, `${fieldName} sayısal olmalıdır`);
  return Math.trunc(numeric);
};

const parseBool = (value, fallback = undefined) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return fallback;
};

const parsePage = (query = {}) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 30));
  return { page, limit, skip: (page - 1) * limit };
};

const listResponse = (res, { items, total, page, limit, filters = {} }) => res.json({
  success: true,
  data: items,
  meta: {
    pagination: {
      mode: 'offset',
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      hasNextPage: page * limit < total,
    },
    filters,
  },
});

const parseJsonObject = (value, fieldName = 'metadata') => {
  if (value === undefined || value === null || value === '') return undefined;
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      throw new AppError(400, `${fieldName} geçerli JSON olmalıdır`);
    }
  }
  throw new AppError(400, `${fieldName} obje formatında olmalıdır`);
};

const ensureBeaconIdentityUnique = async ({ id = null, deviceCode, uuid, major, minor }) => {
  const prisma = await getPrisma();
  if (deviceCode) {
    const existing = await prisma.beaconDevice.findUnique({ where: { deviceCode } });
    if (existing && existing.id !== id) throw new AppError(409, 'Bu Device ID / Code zaten kullanılıyor');
  }
  if (uuid && major !== null && minor !== null) {
    const existing = await prisma.beaconDevice.findFirst({ where: { uuid, major, minor } });
    if (existing && existing.id !== id) throw new AppError(409, 'Bu UUID / Major / Minor kombinasyonu zaten kullanılıyor');
  }
};

const buildBeaconData = async (payload = {}, existing = {}) => {
  const deviceCode = normalizeText(payload.deviceCode ?? payload.deviceId ?? existing.deviceCode);
  if (!deviceCode) throw new AppError(400, 'Device ID / Code zorunludur');
  const uuid = normalizeText(payload.uuid ?? existing.uuid) || null;
  const major = toNullableInt(payload.major ?? existing.major, 'major');
  const minor = toNullableInt(payload.minor ?? existing.minor, 'minor');
  await ensureBeaconIdentityUnique({ id: existing.id || null, deviceCode, uuid, major, minor });
  const metadata = parseJsonObject(payload.metadata, 'metadata');
  const linkedEslDeviceId = normalizeText(payload.eslDeviceId ?? payload.linkedEslDeviceId);
  const nextMetadata = metadata !== undefined
    ? { ...metadata }
    : (existing.metadata && typeof existing.metadata === 'object' && !Array.isArray(existing.metadata) ? { ...existing.metadata } : undefined);
  if (nextMetadata && (payload.eslDeviceId !== undefined || payload.linkedEslDeviceId !== undefined)) {
    if (linkedEslDeviceId) nextMetadata.eslDeviceId = linkedEslDeviceId;
    else delete nextMetadata.eslDeviceId;
  }
  return {
    name: normalizeText(payload.name ?? existing.name) || null,
    deviceCode,
    uuid,
    major,
    minor,
    storeId: normalizeText(payload.storeId ?? existing.storeId) || null,
    locationZoneId: normalizeText(payload.locationZoneId ?? existing.locationZoneId) || null,
    sectionId: normalizeText(payload.sectionId ?? existing.sectionId) || null,
    status: normalizeUpper(payload.status ?? existing.status ?? 'ACTIVE') || 'ACTIVE',
    firmwareVersion: normalizeText(payload.firmwareVersion ?? existing.firmwareVersion) || null,
    batteryLevel: toNullableInt(payload.batteryLevel ?? existing.batteryLevel, 'batteryLevel'),
    ...(nextMetadata !== undefined ? { metadata: nextMetadata } : {}),
  };
};

const buildZoneData = (payload = {}, existing = {}) => {
  const name = normalizeText(payload.name ?? existing.name);
  const code = normalizeText(payload.code ?? existing.code);
  const type = normalizeUpper(payload.type ?? existing.type);
  if (!name) throw new AppError(400, 'Zone adı zorunludur');
  if (!code) throw new AppError(400, 'Zone kodu zorunludur');
  if (!type) throw new AppError(400, 'Zone tipi zorunludur');
  const metadata = parseJsonObject(payload.metadata, 'metadata');
  return {
    name,
    code,
    type,
    storeId: normalizeText(payload.storeId ?? existing.storeId) || null,
    sectionId: normalizeText(payload.sectionId ?? existing.sectionId) || null,
    description: normalizeText(payload.description ?? existing.description) || null,
    isActive: parseBool(payload.isActive, existing.isActive ?? true),
    ...(metadata !== undefined ? { metadata } : {}),
  };
};

const buildRuleData = (payload = {}, existing = {}) => {
  const name = normalizeText(payload.name ?? existing.name);
  const targetType = normalizeText(payload.targetType ?? existing.targetType).toLowerCase();
  const trigger = normalizeUpper(payload.trigger ?? existing.trigger);
  const title = normalizeText(payload.title ?? existing.title);
  const body = normalizeText(payload.body ?? payload.message ?? existing.body);
  if (!name) throw new AppError(400, 'Kural adı zorunludur');
  if (targetType !== 'customer') throw new AppError(400, 'Faz-1 proximity kuralları sadece müşteri hedefi kabul eder');
  if (!['ZONE_ENTER', 'DWELL'].includes(trigger)) throw new AppError(400, 'Tetikleyici geçersiz');
  if (!title || !body) throw new AppError(400, 'Başlık ve mesaj zorunludur');
  const cooldownMinutes = Math.max(1, Number(payload.cooldownMinutes ?? existing.cooldownMinutes ?? 30) || 30);
  const actionUrl = normalizeText(payload.actionUrl ?? existing.actionUrl) || null;
  if (actionUrl && !actionUrl.startsWith('/musteri')) throw new AppError(400, 'Proximity actionUrl /musteri route ile başlamalıdır');
  const payloadJson = parseJsonObject(payload.payload, 'payload');
  return {
    name,
    targetType,
    trigger,
    locationZoneId: normalizeText(payload.locationZoneId ?? existing.locationZoneId) || null,
    beaconDeviceId: normalizeText(payload.beaconDeviceId ?? existing.beaconDeviceId) || null,
    title,
    body,
    actionType: normalizeText(payload.actionType ?? existing.actionType) || null,
    actionUrl,
    cooldownMinutes,
    maxPerVisit: toNullableInt(payload.maxPerVisit ?? existing.maxPerVisit, 'maxPerVisit'),
    priority: Number(payload.priority ?? existing.priority ?? 0) || 0,
    isActive: parseBool(payload.isActive, existing.isActive ?? true),
    ...(payloadJson !== undefined ? { payload: payloadJson } : {}),
  };
};

const enrichBeacons = async (items = []) => {
  const prisma = await getPrisma();
  const [zones, sections, eslDevices] = await Promise.all([
    prisma.locationZone.findMany({ select: { id: true, name: true, code: true } }),
    prisma.section.findMany({ select: { id: true, name: true, number: true } }),
    prisma.eslDevice.findMany({ select: { id: true, name: true, macAddress: true } }),
  ]);
  const zoneMap = new Map(zones.map((item) => [item.id, item]));
  const sectionMap = new Map(sections.map((item) => [item.id, item]));
  const eslMap = new Map(eslDevices.map((item) => [item.id, item]));
  return items.map((item) => ({
    ...item,
    eslDeviceId: item.metadata?.eslDeviceId || null,
    linkedEslDeviceId: item.metadata?.eslDeviceId || null,
    linkedEslDevice: item.metadata?.eslDeviceId ? eslMap.get(item.metadata.eslDeviceId) || null : null,
    zone: item.locationZoneId ? zoneMap.get(item.locationZoneId) || null : null,
    locationZone: item.locationZoneId ? zoneMap.get(item.locationZoneId) || null : null,
    section: item.sectionId ? sectionMap.get(item.sectionId) || null : null,
  }));
};

const enrichZones = async (items = []) => {
  const prisma = await getPrisma();
  const [sections, counts] = await Promise.all([
    prisma.section.findMany({ select: { id: true, name: true, number: true } }),
    prisma.beaconDevice.groupBy({ by: ['locationZoneId'], _count: { _all: true }, where: { locationZoneId: { not: null } } }),
  ]);
  const sectionMap = new Map(sections.map((item) => [item.id, item]));
  const countMap = new Map(counts.map((item) => [item.locationZoneId, item._count._all]));
  return items.map((item) => ({
    ...item,
    section: item.sectionId ? sectionMap.get(item.sectionId) || null : null,
    beaconCount: countMap.get(item.id) || 0,
  }));
};

const enrichRules = async (items = []) => {
  const prisma = await getPrisma();
  const [zones, beacons] = await Promise.all([
    prisma.locationZone.findMany({ select: { id: true, name: true, code: true } }),
    prisma.beaconDevice.findMany({ select: { id: true, name: true, deviceCode: true } }),
  ]);
  const zoneMap = new Map(zones.map((item) => [item.id, item]));
  const beaconMap = new Map(beacons.map((item) => [item.id, item]));
  return items.map((item) => ({
    ...item,
    zone: item.locationZoneId ? zoneMap.get(item.locationZoneId) || null : null,
    locationZone: item.locationZoneId ? zoneMap.get(item.locationZoneId) || null : null,
    beacon: item.beaconDeviceId ? beaconMap.get(item.beaconDeviceId) || null : null,
    beaconDevice: item.beaconDeviceId ? beaconMap.get(item.beaconDeviceId) || null : null,
  }));
};

export const proximityController = {
  async createEvent(req, res, next) {
    try {
      const data = await proximityService.recordEvent(req.body || {}, req.proximityActor);
      res.status(201).json(data);
    } catch (error) {
      next(error);
    }
  },

  async listBeacons(req, res, next) {
    try {
      const prisma = await getPrisma();
      const { page, limit, skip } = parsePage(req.query);
      const search = normalizeText(req.query.search);
      const where = {
        ...(search ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { deviceCode: { contains: search, mode: 'insensitive' } },
            { uuid: { contains: search, mode: 'insensitive' } },
          ],
        } : {}),
        ...(req.query.status ? { status: normalizeUpper(req.query.status) } : {}),
        ...(req.query.zoneId ? { locationZoneId: normalizeText(req.query.zoneId) } : {}),
      };
      const [total, rows] = await Promise.all([
        prisma.beaconDevice.count({ where }),
        prisma.beaconDevice.findMany({ where, orderBy: [{ updatedAt: 'desc' }], skip, take: limit }),
      ]);
      listResponse(res, { items: await enrichBeacons(rows), total, page, limit, filters: req.query });
    } catch (error) { next(error); }
  },

  async createBeacon(req, res, next) {
    try {
      const prisma = await getPrisma();
      const data = await buildBeaconData(req.body || {});
      res.status(201).json({ success: true, data: (await enrichBeacons([await prisma.beaconDevice.create({ data })]))[0] });
    } catch (error) { next(error); }
  },

  async updateBeacon(req, res, next) {
    try {
      const prisma = await getPrisma();
      const existing = await prisma.beaconDevice.findUnique({ where: { id: req.params.id } });
      if (!existing) throw createNotFoundError('Beacon cihazı bulunamadı');
      const data = await buildBeaconData(req.body || {}, existing);
      res.json({ success: true, data: (await enrichBeacons([await prisma.beaconDevice.update({ where: { id: existing.id }, data })]))[0] });
    } catch (error) { next(error); }
  },

  async updateBeaconStatus(req, res, next) {
    try {
      const prisma = await getPrisma();
      const status = normalizeUpper(req.body?.status);
      if (!['ACTIVE', 'PASSIVE', 'MAINTENANCE'].includes(status)) throw new AppError(400, 'Geçersiz cihaz durumu');
      const row = await prisma.beaconDevice.update({ where: { id: req.params.id }, data: { status } });
      res.json({ success: true, data: (await enrichBeacons([row]))[0] });
    } catch (error) { next(error); }
  },

  async deleteBeacon(req, res, next) {
    try {
      const prisma = await getPrisma();
      const row = await prisma.beaconDevice.update({ where: { id: req.params.id }, data: { status: 'PASSIVE' } });
      res.json({ success: true, data: row });
    } catch (error) { next(error); }
  },

  async listZones(req, res, next) {
    try {
      const prisma = await getPrisma();
      const { page, limit, skip } = parsePage(req.query);
      const search = normalizeText(req.query.search);
      const where = {
        ...(search ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { code: { contains: search, mode: 'insensitive' } }] } : {}),
        ...(req.query.type ? { type: normalizeUpper(req.query.type) } : {}),
        ...(req.query.isActive !== undefined ? { isActive: parseBool(req.query.isActive) } : {}),
      };
      const [total, rows] = await Promise.all([
        prisma.locationZone.count({ where }),
        prisma.locationZone.findMany({ where, orderBy: [{ updatedAt: 'desc' }], skip, take: limit }),
      ]);
      listResponse(res, { items: await enrichZones(rows), total, page, limit, filters: req.query });
    } catch (error) { next(error); }
  },

  async createZone(req, res, next) {
    try {
      const prisma = await getPrisma();
      const row = await prisma.locationZone.create({ data: buildZoneData(req.body || {}) });
      res.status(201).json({ success: true, data: (await enrichZones([row]))[0] });
    } catch (error) { next(error); }
  },

  async updateZone(req, res, next) {
    try {
      const prisma = await getPrisma();
      const existing = await prisma.locationZone.findUnique({ where: { id: req.params.id } });
      if (!existing) throw createNotFoundError('Zone bulunamadı');
      const row = await prisma.locationZone.update({ where: { id: existing.id }, data: buildZoneData(req.body || {}, existing) });
      res.json({ success: true, data: (await enrichZones([row]))[0] });
    } catch (error) { next(error); }
  },

  async listRules(req, res, next) {
    try {
      const prisma = await getPrisma();
      const { page, limit, skip } = parsePage(req.query);
      const where = {
        ...(req.query.targetType ? { targetType: normalizeText(req.query.targetType).toLowerCase() } : {}),
        ...(req.query.trigger ? { trigger: normalizeUpper(req.query.trigger) } : {}),
        ...(req.query.isActive !== undefined ? { isActive: parseBool(req.query.isActive) } : {}),
      };
      const [total, rows] = await Promise.all([
        prisma.notificationRule.count({ where }),
        prisma.notificationRule.findMany({ where, orderBy: [{ priority: 'desc' }, { updatedAt: 'desc' }], skip, take: limit }),
      ]);
      listResponse(res, { items: await enrichRules(rows), total, page, limit, filters: req.query });
    } catch (error) { next(error); }
  },

  async createRule(req, res, next) {
    try {
      const prisma = await getPrisma();
      const row = await prisma.notificationRule.create({ data: buildRuleData(req.body || {}) });
      res.status(201).json({ success: true, data: (await enrichRules([row]))[0] });
    } catch (error) { next(error); }
  },

  async updateRule(req, res, next) {
    try {
      const prisma = await getPrisma();
      const existing = await prisma.notificationRule.findUnique({ where: { id: req.params.id } });
      if (!existing) throw createNotFoundError('Bildirim kuralı bulunamadı');
      const row = await prisma.notificationRule.update({ where: { id: existing.id }, data: buildRuleData(req.body || {}, existing) });
      res.json({ success: true, data: (await enrichRules([row]))[0] });
    } catch (error) { next(error); }
  },

  async updateRuleStatus(req, res, next) {
    try {
      const prisma = await getPrisma();
      const row = await prisma.notificationRule.update({ where: { id: req.params.id }, data: { isActive: parseBool(req.body?.isActive, true) } });
      res.json({ success: true, data: (await enrichRules([row]))[0] });
    } catch (error) { next(error); }
  },

  async listEvents(req, res, next) {
    try {
      const prisma = await getPrisma();
      const { page, limit, skip } = parsePage(req.query);
      const where = {
        ...(req.query.userType ? { userType: normalizeText(req.query.userType).toLowerCase() } : {}),
        ...(req.query.beaconDeviceId ? { beaconDeviceId: normalizeText(req.query.beaconDeviceId) } : {}),
        ...(req.query.locationZoneId ? { locationZoneId: normalizeText(req.query.locationZoneId) } : {}),
        ...(req.query.eventType ? { eventType: normalizeUpper(req.query.eventType) } : {}),
        ...(req.query.source ? { source: normalizeUpper(req.query.source) } : {}),
      };
      const [total, rows, beacons, zones, deliveries, users, customers] = await Promise.all([
        prisma.proximityEvent.count({ where }),
        prisma.proximityEvent.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }),
        prisma.beaconDevice.findMany({ select: { id: true, name: true, deviceCode: true } }),
        prisma.locationZone.findMany({ select: { id: true, name: true, code: true } }),
        prisma.notificationDelivery.findMany({ orderBy: { createdAt: 'desc' }, take: 500 }),
        prisma.user.findMany({ select: { id: true, name: true, email: true, username: true } }),
        prisma.customer.findMany({ select: { id: true, name: true, email: true, phone: true, customerNo: true } }),
      ]);
      const beaconMap = new Map(beacons.map((item) => [item.id, item]));
      const zoneMap = new Map(zones.map((item) => [item.id, item]));
      const deliveryByEvent = new Map(deliveries.map((item) => [item.proximityEventId, item]));
      const userMap = new Map(users.map((item) => [item.id, item]));
      const customerMap = new Map(customers.map((item) => [item.id, item]));
      const items = rows.map((row) => {
        const delivery = deliveryByEvent.get(row.id);
        const actor = row.userType === 'customer'
          ? customerMap.get(row.userId)
          : userMap.get(row.userId);
        return {
          ...row,
          beacon: row.beaconDeviceId ? beaconMap.get(row.beaconDeviceId) || null : null,
          beaconDevice: row.beaconDeviceId ? beaconMap.get(row.beaconDeviceId) || null : null,
          zone: row.locationZoneId ? zoneMap.get(row.locationZoneId) || null : null,
          locationZone: row.locationZoneId ? zoneMap.get(row.locationZoneId) || null : null,
          user: row.userId ? actor || null : null,
          actor: row.userId ? actor || null : null,
          delivery: delivery || null,
          result: delivery?.status || 'LOGGED',
          reason: delivery?.skipReason || null,
        };
      });
      listResponse(res, { items, total, page, limit, filters: req.query });
    } catch (error) { next(error); }
  },

  async listDeliveries(req, res, next) {
    try {
      const prisma = await getPrisma();
      const { page, limit, skip } = parsePage(req.query);
      const where = {
        ...(req.query.status ? { status: normalizeUpper(req.query.status) } : {}),
        ...(req.query.skipReason ? { skipReason: normalizeUpper(req.query.skipReason) } : {}),
        ...(req.query.beaconDeviceId ? { beaconDeviceId: normalizeText(req.query.beaconDeviceId) } : {}),
        ...(req.query.locationZoneId ? { locationZoneId: normalizeText(req.query.locationZoneId) } : {}),
      };
      const [total, rows, rules, beacons, zones, notifications, users, customers, events] = await Promise.all([
        prisma.notificationDelivery.count({ where }),
        prisma.notificationDelivery.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }),
        prisma.notificationRule.findMany({ select: { id: true, name: true } }),
        prisma.beaconDevice.findMany({ select: { id: true, name: true, deviceCode: true } }),
        prisma.locationZone.findMany({ select: { id: true, name: true, code: true } }),
        prisma.notification.findMany({ select: { id: true, title: true, type: true, payload: true } }),
        prisma.user.findMany({ select: { id: true, name: true, email: true, username: true } }),
        prisma.customer.findMany({ select: { id: true, name: true, email: true, phone: true, customerNo: true } }),
        prisma.proximityEvent.findMany({ select: { id: true, userId: true, userType: true } }),
      ]);
      const ruleMap = new Map(rules.map((item) => [item.id, item]));
      const beaconMap = new Map(beacons.map((item) => [item.id, item]));
      const zoneMap = new Map(zones.map((item) => [item.id, item]));
      const notificationMap = new Map(notifications.map((item) => [item.id, item]));
      const userMap = new Map(users.map((item) => [item.id, item]));
      const customerMap = new Map(customers.map((item) => [item.id, item]));
      const eventMap = new Map(events.map((item) => [item.id, item]));
      const items = rows.map((row) => {
        const event = row.proximityEventId ? eventMap.get(row.proximityEventId) || null : null;
        const actorType = event?.userType || null;
        const actor = actorType === 'customer'
          ? customerMap.get(row.userId)
          : userMap.get(row.userId);
        return {
          ...row,
          rule: row.notificationRuleId ? ruleMap.get(row.notificationRuleId) || null : null,
          notificationRule: row.notificationRuleId ? ruleMap.get(row.notificationRuleId) || null : null,
          beacon: row.beaconDeviceId ? beaconMap.get(row.beaconDeviceId) || null : null,
          beaconDevice: row.beaconDeviceId ? beaconMap.get(row.beaconDeviceId) || null : null,
          zone: row.locationZoneId ? zoneMap.get(row.locationZoneId) || null : null,
          locationZone: row.locationZoneId ? zoneMap.get(row.locationZoneId) || null : null,
          notification: row.notificationId ? notificationMap.get(row.notificationId) || null : null,
          productId: notificationMap.get(row.notificationId)?.payload?.productId || null,
          productName: notificationMap.get(row.notificationId)?.payload?.productName || null,
          zoneName: notificationMap.get(row.notificationId)?.payload?.zoneName || zoneMap.get(row.locationZoneId)?.name || null,
          proximityEvent: event,
          user: row.userId ? actor || null : null,
          actor: row.userId ? actor || null : null,
        };
      });
      listResponse(res, { items, total, page, limit, filters: req.query });
    } catch (error) { next(error); }
  },
};
