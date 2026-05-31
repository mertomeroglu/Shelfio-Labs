import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const srcDir = path.resolve(__dirname, '..');
const backendRootDir = path.resolve(srcDir, '..');
const repoRootDir = path.resolve(backendRootDir, '..');
const nodeEnv = String(process.env.NODE_ENV || '').trim().toLowerCase();
const isProductionRuntime = nodeEnv === 'production';
const shouldOverrideDotenv = !isProductionRuntime;

dotenv.config({ path: path.resolve(repoRootDir, '.env'), override: false });
dotenv.config({ path: path.resolve(backendRootDir, '.env'), override: shouldOverrideDotenv });

const parseBoolean = (value, fallback = false) => {
  if (typeof value === 'boolean') {
    return value;
  }

  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }

  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) {
    return true;
  }

  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
};

const parseStrictTrue = (value) => String(value || '').trim().toLowerCase() === 'true';

const parseOptionalBoolean = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return null;
  }

  return parseBoolean(normalized, false);
};

const parsePort = (value, fallback = 0) => {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parsePositiveSeconds = (value, fallback) => {
  const parsed = Number(String(value || '').trim());
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : fallback;
};

const parsePositiveMilliseconds = (value, fallback) => {
  const parsed = Number(String(value || '').trim());
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : fallback;
};

const toList = (value) => String(value || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

const maskEmail = (value = '') => {
  const text = String(value || '').trim();
  const atIndex = text.lastIndexOf('@');
  if (atIndex <= 0) return text ? '***' : '';
  const local = text.slice(0, atIndex);
  const domain = text.slice(atIndex + 1);
  const visibleLocal = local.length <= 2 ? `${local[0] || ''}***` : `${local.slice(0, 2)}***`;
  return `${visibleLocal}@${domain}`;
};

const emailDomain = (value = '') => {
  const text = String(value || '').trim();
  const atIndex = text.lastIndexOf('@');
  return atIndex > -1 ? text.slice(atIndex + 1).toLowerCase() : '';
};

const requestedDataStore = String(process.env.DATA_STORE || process.env.STORAGE_DRIVER || '').trim().toLowerCase();
const runStartupMaintenance = parseBoolean(process.env.RUN_STARTUP_MAINTENANCE, false);
if (requestedDataStore === 'json') {
  throw new Error('JSON data store is no longer supported. Use PostgreSQL.');
}
const dataStore = 'postgres';

const resolveDatabaseInfo = (databaseUrl = '') => {
  if (!databaseUrl) {
    return {
      provider: 'postgresql',
      hasUrl: false,
      host: '',
      port: '',
      database: '',
    };
  }

  try {
    const parsed = new URL(databaseUrl);
    return {
      provider: parsed.protocol.replace(':', '') || 'postgresql',
      hasUrl: true,
      host: parsed.hostname,
      port: parsed.port || '5432',
      database: parsed.pathname.replace(/^\//, ''),
    };
  } catch {
    return {
      provider: 'postgresql',
      hasUrl: true,
      host: 'invalid-url',
      port: '',
      database: '',
    };
  }
};

const smtpPort = parsePort(process.env.SMTP_PORT, 0);
const smtpSecureEnv = parseOptionalBoolean(process.env.SMTP_SECURE);
const smtpSecure = smtpPort === 465
  ? true
  : smtpPort === 587
    ? false
    : (smtpSecureEnv ?? false);
const supportUploadDir = path.resolve(
  process.env.SUPPORT_UPLOAD_DIR || process.env.UPLOAD_DIR || path.join(backendRootDir, 'storage', 'support-uploads')
);
const publicAppBaseUrl = String(process.env.PUBLIC_APP_BASE_URL || process.env.FRONTEND_BASE_URL || 'https://shelfiolabs.com').replace(/\/+$/, '');
const normalizeUrl = (value, fallback) => String(value || fallback || '').trim().replace(/\/+$/, '');
const normalizeLicenseMode = (value) => {
  const mode = String(value || 'off').trim().toLowerCase();
  return ['off', 'shadow', 'enforce'].includes(mode) ? mode : 'off';
};

export const config = {
  port: parsePort(process.env.PORT, 4000),
  dataStore,
  requestedDataStore: requestedDataStore || '(default)',
  runStartupMaintenance,
  databaseUrl: process.env.DATABASE_URL || '',
  databaseInfo: resolveDatabaseInfo(process.env.DATABASE_URL || ''),
  prismaLogQueries: parseBoolean(process.env.PRISMA_LOG_QUERIES, false),
  jwtSecret: process.env.JWT_SECRET || 'stok-takip-sistemi-default-secret',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '8h',
  staffRefreshSecret: process.env.STAFF_REFRESH_SECRET || process.env.JWT_SECRET || 'stok-takip-sistemi-default-secret',
  staffRefreshExpiresIn: process.env.STAFF_REFRESH_EXPIRES_IN || '7d',
  customerRefreshSecret: process.env.CUSTOMER_REFRESH_SECRET || process.env.JWT_SECRET || 'stok-takip-sistemi-default-secret',
  customerRefreshExpiresIn: process.env.CUSTOMER_REFRESH_EXPIRES_IN || '30d',
  supportMailTo: process.env.SUPPORT_TO_EMAIL || process.env.SUPPORT_MAIL_TO || '',
  supportMailFromName: process.env.SMTP_FROM_NAME || 'Shelfio Personel',
  supportMailFromEmail: process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || process.env.SUPPORT_MAIL_FROM || '',
  supportMailReplyTo: process.env.SMTP_REPLY_TO || '',
  smtpHost: process.env.SMTP_HOST || '',
  smtpPort,
  smtpSecure,
  smtpUser: process.env.SMTP_USER || '',
  smtpPass: process.env.SMTP_PASS || '',
  smtpConnectionTimeoutMs: parsePort(process.env.SMTP_CONNECTION_TIMEOUT_MS, 10000),
  smtpGreetingTimeoutMs: parsePort(process.env.SMTP_GREETING_TIMEOUT_MS, 10000),
  smtpSocketTimeoutMs: parsePort(process.env.SMTP_SOCKET_TIMEOUT_MS, 15000),
  publicAppBaseUrl,
  publicApiBaseUrl: process.env.PUBLIC_API_BASE_URL || `http://localhost:${parsePort(process.env.PORT, 4000)}`,
  mailContactEmail: process.env.MAIL_CONTACT_EMAIL || process.env.SMTP_REPLY_TO || process.env.SUPPORT_TO_EMAIL || 'info@shelfiolabs.com',
  proximityProductDedupeSeconds: parsePositiveSeconds(process.env.PROXIMITY_PRODUCT_DEDUPE_SECONDS, 12 * 60 * 60),
  eslDeviceToken: process.env.ESL_DEVICE_TOKEN || '',
  eslDeviceTokens: process.env.ESL_DEVICE_TOKENS || '',
  eslHeartbeatRateLimitPerMinute: parsePort(process.env.ESL_HEARTBEAT_RATE_LIMIT_PER_MINUTE, 20),
  supportUploadDir,
  getshelfioControlApiUrl: normalizeUrl(process.env.GETSHELFIO_CONTROL_API_URL, ''),
  getshelfioControlSecret: process.env.GETSHELFIO_CONTROL_SECRET || '',
  licenseControlEnabled: parseStrictTrue(process.env.LICENSE_CONTROL_ENABLED),
  licenseEnforcementMode: normalizeLicenseMode(process.env.LICENSE_ENFORCEMENT_MODE),
  licenseControlTimeoutMs: parsePositiveMilliseconds(process.env.LICENSE_CONTROL_TIMEOUT_MS, 1500),
  licenseControlCacheTtlSeconds: parsePositiveSeconds(process.env.LICENSE_CONTROL_CACHE_TTL_SECONDS, 300),
  licenseControlFailOpen: parseBoolean(process.env.LICENSE_CONTROL_FAIL_OPEN, true),
  shelfioPublicSiteUrl: normalizeUrl(process.env.SHELFIO_PUBLIC_SITE_URL, 'https://getshelfio.com'),
  mainAppUrl: normalizeUrl(process.env.MAIN_APP_URL, 'https://shelfiolabs.com'),
};

console.info('SMTP config loaded:', {
  dotenvOverride: shouldOverrideDotenv,
  nodeEnv: nodeEnv || '(unset)',
  smtpHost: config.smtpHost || '',
  smtpPort: config.smtpPort || 0,
  smtpSecure: Boolean(config.smtpSecure),
  smtpUser: maskEmail(config.smtpUser),
  smtpUserDomain: emailDomain(config.smtpUser),
  fromEmail: maskEmail(config.supportMailFromEmail),
  fromEmailDomain: emailDomain(config.supportMailFromEmail),
  replyTo: maskEmail(config.supportMailReplyTo),
  supportToEmail: toList(config.supportMailTo).map(maskEmail),
  supportToEmailDomain: toList(config.supportMailTo).map(emailDomain),
  hasPassword: Boolean(config.smtpPass),
});

export const dataDefaults = {
  users: [
    {
      id: 'u-admin-1',
      username: 'mert.omeroglu@shelfio.com',
      passwordHash: '$2a$10$qcAMeEdSTZy5QxuS52nD.O/UJX1P36jNKgqZ.TycKxvzRD3PkIr8a',
      role: 'admin',
      storeId: 'store-main',
      registerPin: '0007',
      name: 'Mert Ömeroğlu',
      email: 'mert.omeroglu@shelfio.com',
      isActive: true,
      lastLoginAt: '2026-03-08T08:45:00.000Z',
      createdAt: '2026-03-08T08:00:00.000Z',
      updatedAt: '2026-03-08T08:45:00.000Z'
    },
    {
      id: 'u-user-1',
      username: 'emirhan.karali@shelfio.com',
      passwordHash: '$2a$10$uQT9PHKaefE/02oS1A/v7.i4YrmJMiwJldlwBGjwr7PRIqbhhna0O',
      role: 'user',
      storeId: 'store-main',
      registerPin: '1042',
      name: 'Emirhan Karali',
      email: 'emirhan.karali@shelfio.com',
      isActive: true,
      lastLoginAt: null,
      createdAt: '2026-03-08T08:05:00.000Z',
      updatedAt: '2026-03-08T08:05:00.000Z'
    },
    {
      id: 'u-user-2',
      username: 'mustafa.topal@shelfio.com',
      passwordHash: '$2a$10$uQT9PHKaefE/02oS1A/v7.i4YrmJMiwJldlwBGjwr7PRIqbhhna0O',
      role: 'user',
      storeId: 'store-main',
      registerPin: '2085',
      name: 'Mustafa Topal',
      email: 'mustafa.topal@shelfio.com',
      isActive: true,
      lastLoginAt: null,
      createdAt: '2026-03-08T08:10:00.000Z',
      updatedAt: '2026-03-08T08:10:00.000Z'
    }
  ],
  categories: [
    {
      id: 'cat-1',
      name: 'Gıda',
      description: 'Shelfio ürün kategorisi',
      isActive: true,
      createdAt: '2026-03-08T09:20:00.000Z',
      updatedAt: '2026-03-08T09:20:00.000Z'
    }
  ],
  suppliers: [],
  supplierProducts: [],
  products: [],
  stocks: [],
  movements: [],
  stockTransferRequests: [],
  stockTransferRequestAudits: [],
  warehouseLocations: [],
  warehouseMovements: [],
  purchaseSuggestions: [],
  purchaseOrders: [],
  purchaseOrderItems: [],
  catalogImports: [],
  supplierCatalogVersions: [],
  dailyStoreClosings: [],
  tasks: [],
  notifications: [],
  supportTickets: [],
  sections: [],
  eslDevices: [
    {
      id: 'esl-dev-3',
      name: 'esl-001',
      macAddress: 'AA:BB:CC:DD:EE:03',
      model: 'ESP32 Lite 2.9"',
      firmwareVersion: '1.1.5',
      batteryLevel: 62,
      status: 'offline',
      assignedProductId: null,
      lastSyncAt: null,
      location: 'Reyon 3 - Raf C',
      ipAddress: '192.168.1.103',
      isDeleted: false,
      deletedAt: null,
      createdAt: '2026-03-08T09:10:00.000Z',
      updatedAt: '2026-03-08T09:10:00.000Z',
    },
  ],
  eslHistory: [],
  settings: {
    systemName: 'Shelfio',
    businessName: 'Shelfio Magazacilik Ltd. Sti.',
    companyName: 'Shelfio Magazacilik Ltd. Sti.',
    defaultCritical: 12,
    currency: 'TRY',
    dateFormat: 'DD.MM.YYYY',
    timezone: 'Europe/Istanbul',
    dashboardMessage: 'Shelfio Stok ve Fiyat Yönetim Platformu',
    posPin: '1234',
    roleManagementPin: '1234',
    deskPins: {
      B1: '1234',
      B2: '1234',
      B3: '1234',
      B4: '1234',
      B5: '1234',
      B6: '1234',
      B7: '1234',
      B8: '1234',
    },
    customerRelations: {
      giftCards: [],
      campaigns: [],
    },
    storeEmail: 'info@shelfiolabs.com',
    departments: [
      { id: 'sales', name: 'Satış', isActive: true },
      { id: 'operations', name: 'Operasyon', isActive: true },
      { id: 'finance', name: 'Finans', isActive: true },
      { id: 'it', name: 'IT', isActive: true },
      { id: 'management', name: 'Yönetim', isActive: true },
    ],
    roleDepartmentAssignments: {},
    departmentPermissionRules: {},
    developerLogs: [],
    updatedAt: '2026-03-08T09:00:00.000Z',
    holidayMode: false,
    weeklySchedule: [
      { dayKey: 'Pazartesi', opensAt: '10:00', closesAt: '22:00', isClosed: false },
      { dayKey: 'Salı', opensAt: '10:00', closesAt: '22:00', isClosed: false },
      { dayKey: 'Çarşamba', opensAt: '10:00', closesAt: '22:00', isClosed: false },
      { dayKey: 'Perşembe', opensAt: '10:00', closesAt: '22:00', isClosed: false },
      { dayKey: 'Cuma', opensAt: '10:00', closesAt: '22:00', isClosed: false },
      { dayKey: 'Cumartesi', opensAt: '10:00', closesAt: '22:00', isClosed: false },
      { dayKey: 'Pazar', opensAt: '10:00', closesAt: '22:00', isClosed: false },
    ],
    specialDays: [],
    logisticsTariffs: [
      {
        id: 'cargo-standard-intercity-0-1',
        cargoTypeCode: 'standard_intercity',
        cargoTypeName: 'Standart Şehirlerarası',
        deliveryTarget: '1-3 gün',
        storageCompatibility: 'ambient',
        distanceType: 'intercity',
        desiMin: 0,
        desiMax: 1,
        basePriceTl: 87.5,
        incrementalPricePerDesi: null,
        isColdChain: false,
        isFrozenChain: false,
        isInternalTransfer: false,
        isActive: true,
        notes: 'Standart şehirlerarası tarife',
      },
      { id: 'cargo-standard-intercity-1-5', cargoTypeCode: 'standard_intercity', cargoTypeName: 'Standart Şehirlerarası', deliveryTarget: '1-3 gün', storageCompatibility: 'ambient', distanceType: 'intercity', desiMin: 1.01, desiMax: 5, basePriceTl: 130, incrementalPricePerDesi: null, isColdChain: false, isFrozenChain: false, isInternalTransfer: false, isActive: true, notes: '' },
      { id: 'cargo-standard-intercity-5-10', cargoTypeCode: 'standard_intercity', cargoTypeName: 'Standart Şehirlerarası', deliveryTarget: '1-3 gün', storageCompatibility: 'ambient', distanceType: 'intercity', desiMin: 5.01, desiMax: 10, basePriceTl: 175, incrementalPricePerDesi: null, isColdChain: false, isFrozenChain: false, isInternalTransfer: false, isActive: true, notes: '' },
      { id: 'cargo-standard-intercity-10-20', cargoTypeCode: 'standard_intercity', cargoTypeName: 'Standart Şehirlerarası', deliveryTarget: '1-3 gün', storageCompatibility: 'ambient', distanceType: 'intercity', desiMin: 10.01, desiMax: 20, basePriceTl: 300, incrementalPricePerDesi: null, isColdChain: false, isFrozenChain: false, isInternalTransfer: false, isActive: true, notes: '' },
      { id: 'cargo-standard-intercity-20-30', cargoTypeCode: 'standard_intercity', cargoTypeName: 'Standart Şehirlerarası', deliveryTarget: '1-3 gün', storageCompatibility: 'ambient', distanceType: 'intercity', desiMin: 20.01, desiMax: 30, basePriceTl: 450, incrementalPricePerDesi: null, isColdChain: false, isFrozenChain: false, isInternalTransfer: false, isActive: true, notes: '' },
      { id: 'cargo-standard-intercity-30-plus', cargoTypeCode: 'standard_intercity', cargoTypeName: 'Standart Şehirlerarası', deliveryTarget: '1-3 gün', storageCompatibility: 'ambient', distanceType: 'intercity', desiMin: 30, desiMax: null, basePriceTl: 450, incrementalPricePerDesi: 15, isColdChain: false, isFrozenChain: false, isInternalTransfer: false, isActive: true, notes: '30+ deside desi başına ek ücret uygulanır' },

      { id: 'cargo-express-next-day-0-1', cargoTypeCode: 'express_next_day', cargoTypeName: 'Hızlı / Ertesi Gün', deliveryTarget: '1 gün', storageCompatibility: 'ambient', distanceType: 'intercity', desiMin: 0, desiMax: 1, basePriceTl: 110, incrementalPricePerDesi: null, isColdChain: false, isFrozenChain: false, isInternalTransfer: false, isActive: true, notes: '' },
      { id: 'cargo-express-next-day-1-5', cargoTypeCode: 'express_next_day', cargoTypeName: 'Hızlı / Ertesi Gün', deliveryTarget: '1 gün', storageCompatibility: 'ambient', distanceType: 'intercity', desiMin: 1.01, desiMax: 5, basePriceTl: 162.5, incrementalPricePerDesi: null, isColdChain: false, isFrozenChain: false, isInternalTransfer: false, isActive: true, notes: '' },
      { id: 'cargo-express-next-day-5-10', cargoTypeCode: 'express_next_day', cargoTypeName: 'Hızlı / Ertesi Gün', deliveryTarget: '1 gün', storageCompatibility: 'ambient', distanceType: 'intercity', desiMin: 5.01, desiMax: 10, basePriceTl: 220, incrementalPricePerDesi: null, isColdChain: false, isFrozenChain: false, isInternalTransfer: false, isActive: true, notes: '' },
      { id: 'cargo-express-next-day-10-20', cargoTypeCode: 'express_next_day', cargoTypeName: 'Hızlı / Ertesi Gün', deliveryTarget: '1 gün', storageCompatibility: 'ambient', distanceType: 'intercity', desiMin: 10.01, desiMax: 20, basePriceTl: 375, incrementalPricePerDesi: null, isColdChain: false, isFrozenChain: false, isInternalTransfer: false, isActive: true, notes: '' },
      { id: 'cargo-express-next-day-20-30', cargoTypeCode: 'express_next_day', cargoTypeName: 'Hızlı / Ertesi Gün', deliveryTarget: '1 gün', storageCompatibility: 'ambient', distanceType: 'intercity', desiMin: 20.01, desiMax: 30, basePriceTl: 562.5, incrementalPricePerDesi: null, isColdChain: false, isFrozenChain: false, isInternalTransfer: false, isActive: true, notes: '' },
      { id: 'cargo-express-next-day-30-plus', cargoTypeCode: 'express_next_day', cargoTypeName: 'Hızlı / Ertesi Gün', deliveryTarget: '1 gün', storageCompatibility: 'ambient', distanceType: 'intercity', desiMin: 30, desiMax: null, basePriceTl: 562.5, incrementalPricePerDesi: 19, isColdChain: false, isFrozenChain: false, isInternalTransfer: false, isActive: true, notes: '30+ deside desi başına ek ücret uygulanır' },

      { id: 'cargo-cold-chain-0-1', cargoTypeCode: 'cold_chain', cargoTypeName: 'Soğuk Zincir', deliveryTarget: '1 gün', storageCompatibility: 'cold,frozen', distanceType: 'intercity', desiMin: 0, desiMax: 1, basePriceTl: 612.5, incrementalPricePerDesi: null, isColdChain: true, isFrozenChain: false, isInternalTransfer: false, isActive: true, notes: '+0/+4°C ürünler' },
      { id: 'cargo-cold-chain-1-5', cargoTypeCode: 'cold_chain', cargoTypeName: 'Soğuk Zincir', deliveryTarget: '1 gün', storageCompatibility: 'cold,frozen', distanceType: 'intercity', desiMin: 1.01, desiMax: 5, basePriceTl: 655, incrementalPricePerDesi: null, isColdChain: true, isFrozenChain: false, isInternalTransfer: false, isActive: true, notes: '' },
      { id: 'cargo-cold-chain-5-10', cargoTypeCode: 'cold_chain', cargoTypeName: 'Soğuk Zincir', deliveryTarget: '1 gün', storageCompatibility: 'cold,frozen', distanceType: 'intercity', desiMin: 5.01, desiMax: 10, basePriceTl: 700, incrementalPricePerDesi: null, isColdChain: true, isFrozenChain: false, isInternalTransfer: false, isActive: true, notes: '' },
      { id: 'cargo-cold-chain-10-20', cargoTypeCode: 'cold_chain', cargoTypeName: 'Soğuk Zincir', deliveryTarget: '1 gün', storageCompatibility: 'cold,frozen', distanceType: 'intercity', desiMin: 10.01, desiMax: 20, basePriceTl: 850, incrementalPricePerDesi: null, isColdChain: true, isFrozenChain: false, isInternalTransfer: false, isActive: true, notes: '' },
      { id: 'cargo-cold-chain-20-30', cargoTypeCode: 'cold_chain', cargoTypeName: 'Soğuk Zincir', deliveryTarget: '1 gün', storageCompatibility: 'cold,frozen', distanceType: 'intercity', desiMin: 20.01, desiMax: 30, basePriceTl: 1000, incrementalPricePerDesi: null, isColdChain: true, isFrozenChain: false, isInternalTransfer: false, isActive: true, notes: '' },
      { id: 'cargo-cold-chain-30-plus', cargoTypeCode: 'cold_chain', cargoTypeName: 'Soğuk Zincir', deliveryTarget: '1 gün', storageCompatibility: 'cold,frozen', distanceType: 'intercity', desiMin: 30, desiMax: null, basePriceTl: 1000, incrementalPricePerDesi: 60, isColdChain: true, isFrozenChain: false, isInternalTransfer: false, isActive: true, notes: '30+ deside desi başına ek ücret uygulanır' },

      { id: 'cargo-frozen-chain-0-1', cargoTypeCode: 'frozen_chain', cargoTypeName: 'Donuk Zincir', deliveryTarget: '1 gün', storageCompatibility: 'frozen', distanceType: 'intercity', desiMin: 0, desiMax: 1, basePriceTl: 725, incrementalPricePerDesi: null, isColdChain: false, isFrozenChain: true, isInternalTransfer: false, isActive: true, notes: 'Dondurucu ürünler' },
      { id: 'cargo-frozen-chain-1-5', cargoTypeCode: 'frozen_chain', cargoTypeName: 'Donuk Zincir', deliveryTarget: '1 gün', storageCompatibility: 'frozen', distanceType: 'intercity', desiMin: 1.01, desiMax: 5, basePriceTl: 775, incrementalPricePerDesi: null, isColdChain: false, isFrozenChain: true, isInternalTransfer: false, isActive: true, notes: '' },
      { id: 'cargo-frozen-chain-5-10', cargoTypeCode: 'frozen_chain', cargoTypeName: 'Donuk Zincir', deliveryTarget: '1 gün', storageCompatibility: 'frozen', distanceType: 'intercity', desiMin: 5.01, desiMax: 10, basePriceTl: 825, incrementalPricePerDesi: null, isColdChain: false, isFrozenChain: true, isInternalTransfer: false, isActive: true, notes: '' },
      { id: 'cargo-frozen-chain-10-20', cargoTypeCode: 'frozen_chain', cargoTypeName: 'Donuk Zincir', deliveryTarget: '1 gün', storageCompatibility: 'frozen', distanceType: 'intercity', desiMin: 10.01, desiMax: 20, basePriceTl: 1000, incrementalPricePerDesi: null, isColdChain: false, isFrozenChain: true, isInternalTransfer: false, isActive: true, notes: '' },
      { id: 'cargo-frozen-chain-20-30', cargoTypeCode: 'frozen_chain', cargoTypeName: 'Donuk Zincir', deliveryTarget: '1 gün', storageCompatibility: 'frozen', distanceType: 'intercity', desiMin: 20.01, desiMax: 30, basePriceTl: 1200, incrementalPricePerDesi: null, isColdChain: false, isFrozenChain: true, isInternalTransfer: false, isActive: true, notes: '' },
      { id: 'cargo-frozen-chain-30-plus', cargoTypeCode: 'frozen_chain', cargoTypeName: 'Donuk Zincir', deliveryTarget: '1 gün', storageCompatibility: 'frozen', distanceType: 'intercity', desiMin: 30, desiMax: null, basePriceTl: 1200, incrementalPricePerDesi: 75, isColdChain: false, isFrozenChain: true, isInternalTransfer: false, isActive: true, notes: '30+ deside desi başına ek ücret uygulanır' },

      { id: 'cargo-store-transfer-0-5', cargoTypeCode: 'store_transfer', cargoTypeName: 'Mağaza / Depo Transfer', deliveryTarget: 'Aynı gün - 1 gün', storageCompatibility: 'internal', distanceType: 'internal_transfer', desiMin: 0, desiMax: 5, basePriceTl: 60, incrementalPricePerDesi: null, isColdChain: false, isFrozenChain: false, isInternalTransfer: true, isActive: true, notes: 'İç transfer / mağaza besleme / kısa mesafe' },
      { id: 'cargo-store-transfer-5-10', cargoTypeCode: 'store_transfer', cargoTypeName: 'Mağaza / Depo Transfer', deliveryTarget: 'Aynı gün - 1 gün', storageCompatibility: 'internal', distanceType: 'internal_transfer', desiMin: 5.01, desiMax: 10, basePriceTl: 90, incrementalPricePerDesi: null, isColdChain: false, isFrozenChain: false, isInternalTransfer: true, isActive: true, notes: '' },
      { id: 'cargo-store-transfer-10-20', cargoTypeCode: 'store_transfer', cargoTypeName: 'Mağaza / Depo Transfer', deliveryTarget: 'Aynı gün - 1 gün', storageCompatibility: 'internal', distanceType: 'internal_transfer', desiMin: 10.01, desiMax: 20, basePriceTl: 140, incrementalPricePerDesi: null, isColdChain: false, isFrozenChain: false, isInternalTransfer: true, isActive: true, notes: '' },
      { id: 'cargo-store-transfer-20-30', cargoTypeCode: 'store_transfer', cargoTypeName: 'Mağaza / Depo Transfer', deliveryTarget: 'Aynı gün - 1 gün', storageCompatibility: 'internal', distanceType: 'internal_transfer', desiMin: 20.01, desiMax: 30, basePriceTl: 210, incrementalPricePerDesi: null, isColdChain: false, isFrozenChain: false, isInternalTransfer: true, isActive: true, notes: '' },
      { id: 'cargo-store-transfer-30-plus', cargoTypeCode: 'store_transfer', cargoTypeName: 'Mağaza / Depo Transfer', deliveryTarget: 'Aynı gün - 1 gün', storageCompatibility: 'internal', distanceType: 'internal_transfer', desiMin: 30, desiMax: null, basePriceTl: 210, incrementalPricePerDesi: 10, isColdChain: false, isFrozenChain: false, isInternalTransfer: true, isActive: true, notes: '30+ deside desi başına ek ücret uygulanır' },
    ],
  }
};
