import 'dotenv/config';
import { disconnectPrisma, getPrisma } from '../src/providers/postgresProvider.js';

const DEVICE_CODE = 'esp_sut_01';
const LINKED_ESL_DEVICE_ID = 'esl-dev-3';
const BEACON_UUID = 'fda50693-a4e2-4fb1-afcf-c6eb07647825';
const MAJOR = 1;
const MINOR = 101;

const ZONE_ID = 'prox-zone-mobil-promo-01';
const BEACON_ID = 'prox-beacon-esp-sut-01';
const RULE_ID = 'prox-rule-mobil-promo-customer';
const TEST_COOLDOWN_SECONDS = 5;

const TEST_ZONE_CODES = ['zone_promo_01', 'zone_beacon_01', 'zone_sut_reyonu'];
const TEST_NAME_PARTS = ['Mobil Promosyon', 'Raf Beacon', 'Süt Reyonu', 'Test Beacon'];

const nameContainsFilters = (field = 'name') => TEST_NAME_PARTS.map((name) => ({
  [field]: { contains: name, mode: 'insensitive' },
}));

const unique = (values = []) => Array.from(new Set(values.filter(Boolean)));

const countResult = (result) => Number(result?.count || 0);

const main = async () => {
  const prisma = await getPrisma();

  const zones = await prisma.locationZone.findMany({
    where: {
      OR: [
        { id: ZONE_ID },
        { code: { in: TEST_ZONE_CODES } },
        ...nameContainsFilters('name'),
      ],
    },
    select: { id: true },
  });
  const zoneIds = unique([...zones.map((zone) => zone.id), ZONE_ID]);

  const beacons = await prisma.beaconDevice.findMany({
    where: {
      OR: [
        { id: BEACON_ID },
        { deviceCode: DEVICE_CODE },
        { uuid: BEACON_UUID },
        { locationZoneId: { in: zoneIds } },
        ...nameContainsFilters('name'),
      ],
    },
    select: { id: true },
  });
  const beaconIds = unique([...beacons.map((beacon) => beacon.id), BEACON_ID]);

  const rules = await prisma.notificationRule.findMany({
    where: {
      targetType: { equals: 'customer', mode: 'insensitive' },
      OR: [
        { id: RULE_ID },
        { locationZoneId: { in: zoneIds } },
        { beaconDeviceId: { in: beaconIds } },
        ...nameContainsFilters('name'),
      ],
    },
    select: { id: true },
  });
  const ruleIds = unique([...rules.map((rule) => rule.id), RULE_ID]);

  const events = await prisma.proximityEvent.findMany({
    where: {
      OR: [
        { beaconDeviceId: { in: beaconIds } },
        { locationZoneId: { in: zoneIds } },
        { deviceCode: DEVICE_CODE },
        { uuid: BEACON_UUID },
      ],
    },
    select: { id: true },
  });
  const eventIds = unique(events.map((event) => event.id));

  const deliveries = await prisma.notificationDelivery.findMany({
    where: {
      OR: [
        { proximityEventId: { in: eventIds } },
        { beaconDeviceId: { in: beaconIds } },
        { locationZoneId: { in: zoneIds } },
        { notificationRuleId: { in: ruleIds } },
      ],
    },
    select: { notificationId: true },
  });
  const notificationIds = unique(deliveries.map((delivery) => delivery.notificationId));

  const cleanup = await prisma.$transaction(async (tx) => {
    const deletedDeliveries = await tx.notificationDelivery.deleteMany({
      where: {
        OR: [
          { proximityEventId: { in: eventIds } },
          { beaconDeviceId: { in: beaconIds } },
          { locationZoneId: { in: zoneIds } },
          { notificationRuleId: { in: ruleIds } },
        ],
      },
    });

    const deletedEvents = await tx.proximityEvent.deleteMany({
      where: {
        OR: [
          { id: { in: eventIds } },
          { beaconDeviceId: { in: beaconIds } },
          { locationZoneId: { in: zoneIds } },
          { deviceCode: DEVICE_CODE },
          { uuid: BEACON_UUID },
        ],
      },
    });

    const deletedNotifications = await tx.notification.deleteMany({
      where: {
        createdBy: 'proximity-rule-engine',
        OR: [
          { id: { in: notificationIds } },
          { dedupeKey: { contains: RULE_ID } },
          { dedupeKey: { contains: `:${BEACON_ID}:` } },
          { dedupeKey: { contains: `:${ZONE_ID}:` } },
        ],
      },
    });

    const deletedRules = await tx.notificationRule.deleteMany({
      where: {
        targetType: { equals: 'customer', mode: 'insensitive' },
        OR: [
          { id: { in: ruleIds } },
          { locationZoneId: { in: zoneIds } },
          { beaconDeviceId: { in: beaconIds } },
          ...nameContainsFilters('name'),
        ],
      },
    });

    const deletedBeacons = await tx.beaconDevice.deleteMany({
      where: {
        OR: [
          { id: { in: beaconIds } },
          { deviceCode: DEVICE_CODE },
          { uuid: BEACON_UUID },
          { locationZoneId: { in: zoneIds } },
          ...nameContainsFilters('name'),
        ],
      },
    });

    const deletedZones = await tx.locationZone.deleteMany({
      where: {
        OR: [
          { id: { in: zoneIds } },
          { code: { in: TEST_ZONE_CODES } },
          ...nameContainsFilters('name'),
        ],
      },
    });

    const zone = await tx.locationZone.create({
      data: {
        id: ZONE_ID,
        name: 'Mobil Promosyon Alanı 1',
        code: 'zone_promo_01',
        type: 'AISLE',
        sectionId: null,
        description: 'Müşteri proximity bildirimi için kullanılan mobil beacon alanı.',
        isActive: true,
        metadata: {},
      },
    });

    const beacon = await tx.beaconDevice.create({
      data: {
        id: BEACON_ID,
        name: 'Mobil Promosyon Beacon 1',
        deviceCode: DEVICE_CODE,
        uuid: BEACON_UUID,
        major: MAJOR,
        minor: MINOR,
        status: 'ACTIVE',
        locationZoneId: zone.id,
        sectionId: null,
        firmwareVersion: null,
        metadata: { eslDeviceId: LINKED_ESL_DEVICE_ID },
      },
    });

    const rule = await tx.notificationRule.create({
      data: {
        id: RULE_ID,
        name: 'Mobil Promosyon Müşteri Bildirimi',
        targetType: 'customer',
        trigger: 'ZONE_ENTER',
        locationZoneId: zone.id,
        beaconDeviceId: beacon.id,
        title: 'Yakındaki fırsatı kaçırma',
        body: 'Bu alandaki kampanya ve ürünleri inceleyebilirsin.',
        actionType: 'route',
        actionUrl: '/musteri/kampanyalar',
        cooldownMinutes: 1,
        maxPerVisit: null,
        priority: 10,
        isActive: true,
        payload: {
          cooldownSeconds: TEST_COOLDOWN_SECONDS,
          actionLabel: 'Fırsatları Gör',
        },
      },
    });

    return {
      deleted: {
        notificationDeliveries: countResult(deletedDeliveries),
        proximityEvents: countResult(deletedEvents),
        notifications: countResult(deletedNotifications),
        notificationRules: countResult(deletedRules),
        beaconDevices: countResult(deletedBeacons),
        locationZones: countResult(deletedZones),
      },
      created: {
        locationZone: zone,
        beaconDevice: beacon,
        notificationRule: rule,
      },
    };
  });

  console.log(JSON.stringify({
    ok: true,
    message: 'Customer proximity seed completed.',
    cleanup: cleanup.deleted,
    records: {
      locationZone: {
        id: cleanup.created.locationZone.id,
        code: cleanup.created.locationZone.code,
        name: cleanup.created.locationZone.name,
      },
      beaconDevice: {
        id: cleanup.created.beaconDevice.id,
        deviceCode: cleanup.created.beaconDevice.deviceCode,
        linkedEslDeviceId: cleanup.created.beaconDevice.metadata?.eslDeviceId || null,
        uuid: cleanup.created.beaconDevice.uuid,
        major: cleanup.created.beaconDevice.major,
        minor: cleanup.created.beaconDevice.minor,
      },
      notificationRule: {
        id: cleanup.created.notificationRule.id,
        targetType: cleanup.created.notificationRule.targetType,
        trigger: cleanup.created.notificationRule.trigger,
        actionUrl: cleanup.created.notificationRule.actionUrl,
        cooldownSeconds: cleanup.created.notificationRule.payload?.cooldownSeconds || null,
      },
    },
  }, null, 2));
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectPrisma();
  });
