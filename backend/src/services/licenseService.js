import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { getPrisma } from '../providers/postgresProvider.js';
import { config } from '../config/config.js';
import { AppError } from '../utils/appError.js';
import { verifyToken } from '../utils/jwt.js';
import { MAIN_TENANT_ID } from '../tenant/tenantContext.js';
import { hashLicenseKey, normalizeLicenseKey } from '../utils/licenseKey.js';
import { buildLicenseSummaryFromDbLicense } from './licenseSummaryService.js';
import { ensureMainSystemLicense, isMainSystemLicenseKey } from './mainSystemLicenseService.js';
import { PLAN_PAGES, normalizePlanCode } from './ssoProvisioningService.js';

const LICENSE_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const ACTIVE_LICENSE_STATUSES = new Set(['active', 'activated']);

export { hashLicenseKey } from '../utils/licenseKey.js';

const publicLicense = (license) => {
  const licenseSummary = buildLicenseSummaryFromDbLicense(license);
  return {
    id: license.id,
    status: license.status,
    plan: license.plan?.code || license.planCode || '',
    planName: licenseSummary.planName,
    planSlug: licenseSummary.planSlug,
    licenseType: licenseSummary.licenseType,
    isDemo: licenseSummary.isDemo,
    remainingDays: licenseSummary.remainingDays,
    maskedKey: licenseSummary.maskedKey || license.payload?.maskedKey || '',
    enabledModules: Array.isArray(license.enabledModules) ? license.enabledModules : [],
    storeLimit: license.storeLimit,
    userLimit: license.userLimit,
    limits: {
      stores: license.storeLimit,
      users: license.userLimit,
      eslDevices: license.payload?.limits?.eslDevices ?? license.payload?.eslDevices ?? license.payload?.eslDeviceLimit ?? null,
    },
    startsAt: license.activatedAt || license.createdAt,
    activatedAt: license.activatedAt,
    expiresAt: license.expiresAt,
    licenseSummary,
  };
};

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
    throw new AppError(401, 'Lisans doğrulanamadı.', { errorCode: 'license_missing', authStep: 'license_lookup' });
  }

  const status = String(license.status || '').toLowerCase();
  if (status === 'expired') throw new AppError(403, 'Bu lisansın süresi dolmuş.', { errorCode: 'license_expired', authStep: 'license_status', licenseStatus: status });
  if (status === 'revoked') throw new AppError(403, 'Bu lisans iptal edilmiş.', { errorCode: 'license_inactive', authStep: 'license_status', licenseStatus: status });
  if (status === 'suspended') throw new AppError(403, 'Bu lisans askıya alınmış. Destek ile iletişime geçin.', { errorCode: 'license_inactive', authStep: 'license_status', licenseStatus: status });
  if (status === 'pending') throw new AppError(403, 'Bu lisans henüz aktif değil.', { errorCode: 'license_pending', authStep: 'license_status', licenseStatus: status });
  if (!ACTIVE_LICENSE_STATUSES.has(status)) throw new AppError(403, 'Bu lisans aktif değil.', { errorCode: 'license_inactive', authStep: 'license_status', licenseStatus: status });

  if (license.expiresAt && new Date(license.expiresAt).getTime() <= Date.now()) {
    throw new AppError(403, 'Bu lisansın süresi dolmuş.', { errorCode: 'license_expired', authStep: 'license_expiry' });
  }

  if (!license.tenant || String(license.tenant.status || '').toLowerCase() !== 'active') {
    throw new AppError(403, 'Tenant aktif değil.', { errorCode: 'tenant_inactive', authStep: 'tenant_status' });
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
    if (isMainSystemLicenseKey(licenseKey)) {
      await ensureMainSystemLicense({ prisma, licenseKey });
    }
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

    const licenseSummary = buildLicenseSummaryFromDbLicense(license);
    const planCode = licenseSummary.planSlug || license.planCode || '';
    const screenAccess = licenseSummary.screenAccess || license.payload?.screenAccess || PLAN_PAGES[normalizePlanCode(planCode)] || [];

    return {
      licenseSessionToken: token,
      expiresAt: expiresAt.toISOString(),
      tenant: publicTenant(license.tenant),
      activeStore: publicStore(activeStore),
      license: publicLicense(license),
      licenseSummary,
      plan: license.plan ? {
        id: license.plan.id,
        code: license.plan.code,
        name: license.plan.name,
      } : null,
      enabledModules: Array.isArray(license.enabledModules) ? license.enabledModules : [],
      screenAccess,
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

  async resolveLicenseKeyContext({ licenseKey, source = 'admin_web' } = {}) {
    const normalizedKey = normalizeLicenseKey(licenseKey);
    if (!normalizedKey) {
      throw new AppError(401, 'Lisans doğrulanamadı.', { errorCode: 'license_missing', authStep: 'license_lookup' });
    }

    const prisma = await getPrisma();
    if (isMainSystemLicenseKey(normalizedKey)) {
      await ensureMainSystemLicense({ prisma, licenseKey: normalizedKey });
    }

    const license = await prisma.license.findUnique({
      where: { licenseKeyHash: hashLicenseKey(normalizedKey) },
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

    return {
      tenantId: license.tenantId || MAIN_TENANT_ID,
      storeId: activeStore?.id || 'store-main',
      licenseId: license.id,
      tenant: license.tenant,
      activeStore,
      license,
      source,
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

    const licenseSummary = buildLicenseSummaryFromDbLicense(license);
    const planCode = licenseSummary.planSlug || license.planCode || '';
    const screenAccess = licenseSummary.screenAccess || license.payload?.screenAccess || PLAN_PAGES[normalizePlanCode(planCode)] || [];

    return {
      tenant: publicTenant(license.tenant),
      activeStore: publicStore(activeStore),
      license: publicLicense(license),
      licenseSummary,
      plan: license.plan ? {
        id: license.plan.id,
        code: license.plan.code,
        name: license.plan.name,
      } : null,
      enabledModules: Array.isArray(license.enabledModules) ? license.enabledModules : [],
      screenAccess,
    };
  },

  async createSessionForLicense(licenseId, tenantId, storeId, source = 'getshelfio_sso') {
    const prisma = await getPrisma();
    const expiresAt = new Date(Date.now() + LICENSE_SESSION_TTL_SECONDS * 1000);
    const sessionId = uuidv4();
    const token = createLicenseSessionToken({
      sessionId,
      tenantId,
      storeId,
      licenseId,
    });

    await prisma.licenseSession.create({
      data: {
        id: sessionId,
        tenantId,
        licenseId,
        storeId,
        tokenHash: hashSessionToken(token),
        status: 'active',
        expiresAt,
        payload: {
          source,
        },
      },
    });

    return {
      licenseSessionToken: token,
      expiresAt: expiresAt.toISOString(),
    };
  },
};
