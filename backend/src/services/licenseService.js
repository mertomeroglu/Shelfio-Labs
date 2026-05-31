import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { getPrisma } from '../providers/postgresProvider.js';
import { config } from '../config/config.js';
import { AppError } from '../utils/appError.js';
import { verifyToken } from '../utils/jwt.js';
import { MAIN_TENANT_ID } from '../tenant/tenantContext.js';

const LICENSE_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const ACTIVE_LICENSE_STATUSES = new Set(['active', 'activated']);

const normalizeLicenseKey = (value) => String(value || '')
  .trim()
  .toUpperCase()
  .replace(/\s+/g, '');

export const hashLicenseKey = (value) =>
  crypto.createHash('sha256').update(normalizeLicenseKey(value)).digest('hex');

const maskLicenseKey = (value) => {
  const normalized = normalizeLicenseKey(value);
  if (!normalized) return '';

  const parts = normalized.split('-').filter(Boolean);
  if (parts.length >= 3) {
    return [parts[0], ...parts.slice(1, -1).map(() => '****'), parts[parts.length - 1]].join('-');
  }

  if (normalized.length <= 8) return '****';
  return `${normalized.slice(0, 4)}-****-${normalized.slice(-4)}`;
};

const publicLicense = (license) => ({
  id: license.id,
  status: license.status,
  plan: license.plan?.code || license.planCode || '',
  maskedKey: license.payload?.maskedKey || maskLicenseKey(license.payload?.label),
  enabledModules: Array.isArray(license.enabledModules) ? license.enabledModules : [],
  storeLimit: license.storeLimit,
  userLimit: license.userLimit,
  limits: {
    stores: license.storeLimit,
    users: license.userLimit,
    eslDevices: license.payload?.limits?.eslDevices ?? license.payload?.eslDevices ?? license.payload?.eslDeviceLimit ?? null,
  },
  startsAt: license.activatedAt || license.createdAt,
  expiresAt: license.expiresAt,
});

const publicTenant = (tenant) => ({
  id: tenant.id,
  name: tenant.name,
  slug: tenant.slug,
  status: tenant.status,
});

const publicStore = (store) => store ? ({
  id: store.id,
  tenantId: store.tenantId,
  name: store.name,
  code: store.code,
  status: store.status,
}) : null;

const assertUsableLicense = (license) => {
  if (!license) {
    throw new AppError(401, 'Lisans doğrulanamadı.');
  }

  const status = String(license.status || '').toLowerCase();
  if (status === 'expired') throw new AppError(403, 'Bu lisansın süresi dolmuş.');
  if (status === 'revoked') throw new AppError(403, 'Bu lisans iptal edilmiş.');
  if (status === 'suspended') throw new AppError(403, 'Bu lisans askıya alınmış. Destek ile iletişime geçin.');
  if (status === 'pending') throw new AppError(403, 'Bu lisans henüz aktif değil.');
  if (!ACTIVE_LICENSE_STATUSES.has(status)) throw new AppError(403, 'Bu lisans aktif değil.');

  if (license.expiresAt && new Date(license.expiresAt).getTime() <= Date.now()) {
    throw new AppError(403, 'Bu lisansın süresi dolmuş.');
  }

  if (!license.tenant || String(license.tenant.status || '').toLowerCase() !== 'active') {
    throw new AppError(403, 'Tenant aktif değil.');
  }
};

const createLicenseSessionToken = ({ sessionId, tenantId, storeId, licenseId }) => jwt.sign({
  sub: sessionId,
  type: 'license_session',
  tenantId,
  storeId,
  licenseId,
}, config.jwtSecret, { expiresIn: LICENSE_SESSION_TTL_SECONDS });

const hashSessionToken = (token) => crypto.createHash('sha256').update(String(token || '')).digest('hex');

export const licenseService = {
  async verifyLicense(payload = {}) {
    const licenseKey = normalizeLicenseKey(payload.licenseKey);
    if (!licenseKey) {
      throw new AppError(400, 'Lisans anahtarı zorunludur.');
    }

    const prisma = await getPrisma();
    const license = await prisma.license.findUnique({
      where: { licenseKeyHash: hashLicenseKey(licenseKey) },
      include: {
        tenant: true,
        plan: true,
      },
    });

    assertUsableLicense(license);

    const activeStore = await prisma.store.findFirst({
      where: {
        tenantId: license.tenantId,
        status: 'active',
      },
      orderBy: { createdAt: 'asc' },
    });

    const expiresAt = new Date(Date.now() + LICENSE_SESSION_TTL_SECONDS * 1000);
    const sessionId = uuidv4();
    const token = createLicenseSessionToken({
      sessionId,
      tenantId: license.tenantId,
      storeId: activeStore?.id || null,
      licenseId: license.id,
    });

    await prisma.licenseSession.create({
      data: {
        id: sessionId,
        tenantId: license.tenantId,
        licenseId: license.id,
        storeId: activeStore?.id || null,
        tokenHash: hashSessionToken(token),
        status: 'active',
        expiresAt,
        payload: {
          source: payload.source || 'admin_web',
        },
      },
    });

    return {
      licenseSessionToken: token,
      expiresAt: expiresAt.toISOString(),
      tenant: publicTenant(license.tenant),
      activeStore: publicStore(activeStore),
      license: publicLicense(license),
      plan: license.plan ? {
        id: license.plan.id,
        code: license.plan.code,
        name: license.plan.name,
      } : null,
      enabledModules: Array.isArray(license.enabledModules) ? license.enabledModules : [],
    };
  },

  async resolveLicenseSession(token) {
    const rawToken = String(token || '').trim();
    if (!rawToken) {
      throw new AppError(401, 'Lisans oturumu gerekli.');
    }

    let payload;
    try {
      payload = verifyToken(rawToken);
    } catch {
      throw new AppError(401, 'Lisans oturumu geçersiz.');
    }

    if (payload?.type !== 'license_session') {
      throw new AppError(401, 'Lisans oturumu geçersiz.');
    }

    const prisma = await getPrisma();
    const session = await prisma.licenseSession.findUnique({
      where: { id: payload.sub },
      include: {
        tenant: true,
        store: true,
        license: {
          include: { plan: true, tenant: true },
        },
      },
    });

    if (!session || session.tokenHash !== hashSessionToken(rawToken)) {
      throw new AppError(401, 'Lisans oturumu geçersiz.');
    }

    if (session.status !== 'active' || new Date(session.expiresAt).getTime() <= Date.now()) {
      throw new AppError(401, 'Lisans oturumu süresi doldu.');
    }

    assertUsableLicense(session.license);

    return {
      tenantId: session.tenantId || MAIN_TENANT_ID,
      storeId: session.storeId || session.store?.id || 'store-main',
      licenseId: session.licenseId,
      tenant: session.tenant,
      activeStore: session.store,
      license: session.license,
    };
  },

  async validateLicenseSession(token) {
    const session = await this.resolveLicenseSession(token);
    const tenantData = await this.resolveAuthenticatedTenant({
      tenantId: session.tenantId,
      licenseId: session.licenseId,
      storeId: session.storeId,
    });

    return {
      tenantId: session.tenantId,
      storeId: session.storeId,
      licenseId: session.licenseId,
      ...tenantData,
    };
  },

  async resolveAuthenticatedTenant({ tenantId, licenseId, storeId }) {
    const prisma = await getPrisma();
    const license = await prisma.license.findFirst({
      where: {
        tenantId,
        ...(licenseId ? { id: licenseId } : { status: { in: ['active', 'activated'] } }),
      },
      include: {
        tenant: true,
        plan: true,
      },
    });

    assertUsableLicense(license);

    const activeStore = storeId
      ? await prisma.store.findFirst({ where: { id: storeId, tenantId } })
      : await prisma.store.findFirst({ where: { tenantId, status: 'active' }, orderBy: { createdAt: 'asc' } });

    return {
      tenant: publicTenant(license.tenant),
      activeStore: publicStore(activeStore),
      license: publicLicense(license),
      plan: license.plan ? {
        id: license.plan.id,
        code: license.plan.code,
        name: license.plan.name,
      } : null,
      enabledModules: Array.isArray(license.enabledModules) ? license.enabledModules : [],
    };
  },
};
