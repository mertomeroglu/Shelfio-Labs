import crypto from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { getPrisma } from '../providers/postgresProvider.js';
import { runWithTenantContext } from '../tenant/tenantContext.js';
import { AppError } from '../utils/appError.js';
import { hashPassword } from '../utils/password.js';
import { SSO_PASSWORD_MESSAGE, validateSsoPassword } from '../utils/ssoPasswordPolicy.js';
import { auditLogService } from './auditLogService.js';
import { buildLicenseSummaryFromControlPayload, sanitizeLicenseSummary } from './licenseSummaryService.js';

const SETUP_TOKEN_TTL_MS = 10 * 60 * 1000;
const ACTIVE_LICENSE_STATUSES = new Set(['active', 'activated']);
const INACTIVE_LICENSE_STATUSES = new Set(['pending', 'issued', 'revoked', 'cancelled', 'canceled', 'expired', 'suspended']);

const cleanText = (value, max = 250) => String(value || '').trim().slice(0, max);
const normalizeEmail = (value) => cleanText(value, 320).toLowerCase();
const hashOpaqueValue = (value) => crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
const createRawToken = () => crypto.randomBytes(32).toString('base64url');
const toNullableInt = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : null;
};
const toDateOrNull = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
};
const toSlug = (value) => cleanText(value, 100)
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 48) || 'shelfio';
const normalizeModules = (value) => (Array.isArray(value) ? value : [])
  .map((item) => cleanText(item, 100))
  .filter(Boolean);
const isUniqueConflict = (error) => error?.code === 'P2002';

export const normalizePlanCode = (planCode) => {
  const code = String(planCode || '').trim().toLowerCase();
  if (['pro', 'professional', 'profesyonel'].includes(code)) return 'pro';
  if (['enterprise', 'kurumsal'].includes(code)) return 'enterprise';
  if (['demo'].includes(code)) return 'demo';
  if (['starter', 'standard', 'standart'].includes(code)) return 'starter';
  return code || 'starter';
};

export const PLAN_PAGES = {
  demo: [
    'Dashboard',
    'Ürünler',
    'Kategoriler',
    'Nasıl Kullanılır',
    'Personel Yönetimi',
    'Ayarlar',
    'POS / Kasa',
    'Stok İşlemleri',
    'Rol Yönetimi'
  ],
  starter: [
    'Dashboard',
    'Ürünler',
    'Kategoriler',
    'Nasıl Kullanılır',
    'Personel Yönetimi',
    'Ayarlar',
    'POS / Kasa',
    'Stok İşlemleri',
    'Rol Yönetimi',
    'Eşleşmeler',
    'Tedarikçiler',
    'Bildirimler'
  ],
  pro: [
    'Dashboard',
    'Ürünler',
    'Kategoriler',
    'Nasıl Kullanılır',
    'Personel Yönetimi',
    'Ayarlar',
    'POS / Kasa',
    'Stok İşlemleri',
    'Rol Yönetimi',
    'Eşleşmeler',
    'Tedarikçiler',
    'Bildirimler',
    'Lokasyon Yönetimi',
    'SKT Takibi',
    'Depo Transfer Talepleri',
    'Görev Planlama',
    'Raporlar',
    'Sipariş Önerileri',
    'Sipariş Takibi',
    'Sipariş Oluştur',
    'Tedarikçi Ürünleri'
  ],
  enterprise: [
    'Dashboard',
    'Ürünler',
    'Kategoriler',
    'Nasıl Kullanılır',
    'Personel Yönetimi',
    'Ayarlar',
    'POS / Kasa',
    'Stok İşlemleri',
    'Rol Yönetimi',
    'Eşleşmeler',
    'Tedarikçiler',
    'Bildirimler',
    'Lokasyon Yönetimi',
    'SKT Takibi',
    'Depo Transfer Talepleri',
    'Görev Planlama',
    'Raporlar',
    'Sipariş Önerileri',
    'Sipariş Takibi',
    'Sipariş Oluştur',
    'Tedarikçi Ürünleri',
    'Taleplerim',
    'Erişim Talepleri',
    'Fiyat & Talep Analizi',
    'Kampanya Yönetimi',
    'Proximity Yönetimi',
    'Etiket Yönetimi',
    'Müşteri Yönetimi',
    'Müşteri Mobil',
    'Personel Mobil'
  ]
};

export const PAGE_REQUIRED_MODULES = {
  'Dashboard': [],
  'Ürünler': ['products'],
  'Kategoriler': ['products'],
  'Personel Yönetimi': ['users'],
  'Ayarlar': ['settings'],
  'POS / Kasa': ['pos'],
  'Stok İşlemleri': ['stock'],
  'Rol Yönetimi': ['permissions'],
  'Eşleşmeler': ['suppliers'],
  'Tedarikçiler': ['suppliers'],
  'Bildirimler': ['notifications'],
  'Lokasyon Yönetimi': ['warehouse'],
  'SKT Takibi': ['stock', 'stock_batches'],
  'Depo Transfer Talepleri': ['warehouse', 'stock_movements'],
  'Görev Planlama': ['tasks'],
  'Raporlar': ['reports'],
  'Sipariş Önerileri': ['procurement'],
  'Sipariş Takibi': ['procurement', 'purchase_orders'],
  'Sipariş Oluştur': ['procurement', 'purchase_orders'],
  'Tedarikçi Ürünleri': ['procurement'],
  'Taleplerim': ['permissions'],
  'Erişim Talepleri': ['permissions'],
  'Fiyat & Talep Analizi': ['reports'],
  'Kampanya Yönetimi': ['campaigns'],
  'Proximity Yönetimi': ['proximity'],
  'Etiket Yönetimi': ['esl'],
  'Müşteri Yönetimi': ['customers'],
  'Müşteri Mobil': ['customers'],
  'Personel Mobil': ['tasks', 'esl', 'procurement', 'warehouse', 'notifications', 'stock', 'products', 'support'],
};

export const normalizePlanModules = (planCode, incomingModules = [], screenAccess = null) => {
  const normPlan = normalizePlanCode(planCode);
  const activePages = Array.isArray(screenAccess) ? screenAccess : (PLAN_PAGES[normPlan] || PLAN_PAGES.starter);
  
  const derivedModules = [];
  for (const page of activePages) {
    const mods = PAGE_REQUIRED_MODULES[page] || [];
    derivedModules.push(...mods);
  }
  
  const rawModules = Array.isArray(incomingModules) ? incomingModules : [];
  const normalizedIncoming = rawModules
    .map((item) => cleanText(item, 100))
    .filter(Boolean);
    
  const merged = new Set([...derivedModules, ...normalizedIncoming]);
  return Array.from(merged);
};

export const extractSsoProvisioningContext = (payload = {}) => {
  const licenseSummary = buildLicenseSummaryFromControlPayload(payload);
  const license = payload?.license || payload?.entitlement || {};
  const tenant = payload?.tenant || license?.tenant || {};
  const owner = payload?.owner || license?.owner || {};
  const user = payload?.user || payload?.account || payload?.customer || payload?.member || {};
  const plan = payload?.plan || license?.plan || {};
  const limits = payload?.limits || license?.limits || plan?.limits || {};
  const status = cleanText(licenseSummary.status || license?.status || payload?.licenseStatus || payload?.status, 50).toLowerCase();
  const expiresAt = toDateOrNull(licenseSummary.expiresAt || license?.expiresAt || license?.expires_at || payload?.expiresAt);

  const planCode = cleanText(licenseSummary.planSlug || plan?.code || plan?.slug || license?.planCode || license?.plan || payload?.planSlug, 100).toLowerCase();
  const rawModules = normalizeModules(licenseSummary.enabledModules?.length ? licenseSummary.enabledModules : (license?.enabledModules || license?.modules || payload?.enabledModules || payload?.modules));
  
  const normPlan = normalizePlanCode(planCode);
  const screenAccess = licenseSummary.screenAccess || license?.screenAccess || license?.screen_access || payload?.screenAccess || payload?.screen_access || PLAN_PAGES[normPlan] || PLAN_PAGES.starter;
  const enabledModules = normalizePlanModules(planCode, rawModules, screenAccess);
  const normalizedLicenseSummary = sanitizeLicenseSummary({
    ...licenseSummary,
    planSlug: normPlan,
    status,
    expiresAt,
    remainingDays: licenseSummary.remainingDays,
    isDemo: licenseSummary.isDemo || normPlan === 'demo',
    enabledModules,
    screenAccess,
  });

  return {
    externalLicenseId: cleanText(
      licenseSummary.externalLicenseId || license?.id || license?.licenseId || license?.license_id || payload?.licenseId || payload?.externalLicenseId,
      180,
    ),
    externalTenantId: cleanText(
      licenseSummary.externalTenantId || tenant?.id || tenant?.tenantId || tenant?.tenant_id || license?.tenantId || payload?.tenantId,
      180,
    ) || null,
    ownerEmail: normalizeEmail(
      licenseSummary.ownerEmail || owner?.email || license?.ownerEmail || license?.licenseOwnerEmail || payload?.ownerEmail || user?.email || user?.username,
    ),
    userEmail: normalizeEmail(user?.email || user?.username),
    status,
    planCode,
    enabledModules,
    screenAccess,
    storeLimit: toNullableInt(licenseSummary.storeLimit ?? limits?.stores ?? license?.storeLimit),
    userLimit: toNullableInt(licenseSummary.userLimit ?? limits?.users ?? license?.userLimit),
    expiresAt,
    remainingDays: toNullableInt(normalizedLicenseSummary.remainingDays),
    isDemo: Boolean(normalizedLicenseSummary.isDemo),
    licenseSummary: normalizedLicenseSummary,
  };
};

export const assertActiveSsoProvisioningContext = (context = {}) => {
  if (!context.externalLicenseId || !context.status) {
    throw new AppError(400, 'SSO lisans bilgisi dogrulanamadi.', { errorCode: 'license_payload_missing' });
  }

  if (!context.ownerEmail) {
    throw new AppError(400, 'SSO kullanici bilgisi dogrulanamadi.', { errorCode: 'email_missing' });
  }

  if (context.userEmail && context.userEmail !== context.ownerEmail) {
    throw new AppError(403, 'SSO lisans sahibi dogrulanamadi.', { errorCode: 'sso_owner_mismatch' });
  }

  if (INACTIVE_LICENSE_STATUSES.has(context.status) || !ACTIVE_LICENSE_STATUSES.has(context.status)) {
    const errorCode = context.status === 'expired' ? 'license_expired' : 'license_not_active';
    throw new AppError(403, 'Aktif bir Shelfio lisansi bulunamadi.', { errorCode });
  }

  if (Number.isFinite(context.remainingDays) && context.remainingDays < 0) {
    throw new AppError(403, 'Aktif bir Shelfio lisansi bulunamadi.', { errorCode: 'license_expired' });
  }

  if (context.expiresAt && context.expiresAt.getTime() <= Date.now()) {
    throw new AppError(403, 'Aktif bir Shelfio lisansi bulunamadi.', {
      errorCode: context.isDemo ? 'license_expired' : 'license_not_active',
    });
  }

  return context;
};

const publicSetupContext = (context) => ({
  setupRequired: true,
  setupToken: context.setupToken,
  email: context.ownerEmail,
  expiresAt: context.expiresAt?.toISOString() || null,
  licenseSummary: context.licenseSummary || null,
});

const recordProvisioningAudit = async ({ tenantId, userId, email, externalLicenseId }) => {
  try {
    await runWithTenantContext({ tenantId }, () => auditLogService.record({
      actorUserId: userId,
      actorName: email,
      actorRole: 'admin',
      actorEmail: email,
      action: 'İlk admin hesabı oluşturuldu',
      module: 'sso',
      entityType: 'tenant_provisioning',
      entityId: tenantId,
      summary: 'SSO ile tenant ve ilk admin hesabı oluşturuldu.',
      metadata: { externalLicenseId },
      severity: 'info',
      source: 'getshelfio_sso',
    }));
  } catch {
    // Provisioning must not fail because an optional audit write failed.
  }
};

export const createSsoProvisioningService = ({
  getPrismaClient = getPrisma,
  passwordHasher = hashPassword,
  auditRecorder = recordProvisioningAudit,
} = {}) => ({
  async findProvisionedLicense(externalLicenseId) {
    const prisma = await getPrismaClient();
    return prisma.license.findUnique({
      where: { externalLicenseId },
      include: { tenant: true },
    });
  },

  async syncLicenseData(externalLicenseId, context) {
    const prisma = await getPrismaClient();
    const existing = await prisma.license.findUnique({
      where: { externalLicenseId },
    });

    if (!existing) return null;

    const normalizedPlanCode = normalizePlanCode(context.planCode);
    const plan = normalizedPlanCode ? await prisma.plan.findUnique({ where: { code: normalizedPlanCode } }) : null;

    const existingPayload = existing.payload && typeof existing.payload === 'object' ? existing.payload : {};
    const updatedPayload = {
      ...existingPayload,
      licenseSummary: context.licenseSummary || existingPayload.licenseSummary || null,
      maskedKey: context.licenseSummary?.maskedKey || existingPayload.maskedKey,
      licenseType: context.licenseSummary?.licenseType || existingPayload.licenseType,
      remainingDays: context.licenseSummary?.remainingDays ?? existingPayload.remainingDays,
      screenAccess: context.screenAccess || existingPayload.screenAccess || null,
    };

    const updatedLicense = await prisma.license.update({
      where: { id: existing.id },
      data: {
        planId: plan?.id || existing.planId,
        planCode: context.planCode || existing.planCode,
        externalPlan: context.planCode || existing.externalPlan,
        externalStatus: context.status || existing.externalStatus,
        status: ['active', 'activated'].includes(context.status) ? 'active' : existing.status,
        enabledModules: context.enabledModules || existing.enabledModules,
        storeLimit: context.storeLimit !== null ? context.storeLimit : existing.storeLimit,
        userLimit: context.userLimit !== null ? context.userLimit : existing.userLimit,
        expiresAt: context.expiresAt || existing.expiresAt,
        payload: updatedPayload,
      },
    });

    return updatedLicense;
  },

  async createSetupChallenge({ exchangeCode, context }) {
    const prisma = await getPrismaClient();
    const setupToken = createRawToken();
    const expiresAt = new Date(Date.now() + SETUP_TOKEN_TTL_MS);

    try {
      await prisma.ssoSetupToken.create({
        data: {
          id: uuidv4(),
          tokenHash: hashOpaqueValue(setupToken),
          exchangeCodeHash: hashOpaqueValue(exchangeCode),
          externalLicenseId: context.externalLicenseId,
          externalTenantId: context.externalTenantId,
          licenseOwnerEmail: context.ownerEmail,
          licensePlan: context.planCode || null,
          licenseStatus: context.status,
          payload: {
            enabledModules: context.enabledModules,
            screenAccess: context.screenAccess,
            storeLimit: context.storeLimit,
            userLimit: context.userLimit,
            expiresAt: context.expiresAt?.toISOString() || null,
            licenseSummary: context.licenseSummary || null,
          },
          expiresAt,
        },
      });
    } catch (error) {
      if (isUniqueConflict(error)) {
        throw new AppError(409, 'Bu SSO bağlantısı daha önce kullanılmış. Lütfen getshelfio.com üzerinden tekrar deneyin.', {
          errorCode: 'sso_code_already_used',
        });
      }
      throw error;
    }

    return publicSetupContext({ ...context, setupToken, expiresAt });
  },

  async setupTenantAdmin(payload = {}) {
    const setupToken = cleanText(payload.setupToken, 500);
    const adminName = cleanText(payload.adminName, 160);
    const storeName = cleanText(payload.storeName, 160);
    const phone = cleanText(payload.phone, 40);
    const password = String(payload.password || '');
    const passwordConfirm = String(payload.passwordConfirm || '');

    if (!setupToken || !adminName || !storeName || !password || !passwordConfirm) {
      throw new AppError(400, 'Ad soyad, mağaza adı, şifre ve şifre tekrarı zorunludur.');
    }
    if (password !== passwordConfirm) {
      throw new AppError(400, 'Şifreler eşleşmiyor.');
    }
    if (!validateSsoPassword(password)) {
      throw new AppError(400, SSO_PASSWORD_MESSAGE, { errorCode: 'weak_password' });
    }

    const prisma = await getPrismaClient();
    const tokenHash = hashOpaqueValue(setupToken);
    const setupRow = await prisma.ssoSetupToken.findUnique({ where: { tokenHash } });
    if (!setupRow || setupRow.usedAt || setupRow.expiresAt.getTime() <= Date.now()) {
      throw new AppError(400, 'Kurulum bağlantısı geçersiz veya süresi dolmuş.', { errorCode: 'sso_setup_token_invalid' });
    }

    const email = normalizeEmail(setupRow.licenseOwnerEmail);
    if (payload.email && normalizeEmail(payload.email) !== email) {
      throw new AppError(403, 'Lisans sahibi e-posta adresi değiştirilemez.', { errorCode: 'sso_owner_mismatch' });
    }

    const now = new Date();
    const tenantId = uuidv4();
    const storeId = uuidv4();
    const licenseId = uuidv4();
    const userId = uuidv4();
    const passwordHash = await passwordHasher(password);
    const tokenPayload = setupRow.payload && typeof setupRow.payload === 'object' ? setupRow.payload : {};
    const planCode = cleanText(setupRow.licensePlan, 100).toLowerCase() || null;
    const tenantSlug = `${toSlug(storeName)}-${tenantId.slice(0, 8)}`;

    try {
      const provisioned = await runWithTenantContext({ tenantId, storeId, licenseId }, () => prisma.$transaction(async (tx) => {
        const existingLicense = await tx.license.findUnique({
          where: { externalLicenseId: setupRow.externalLicenseId },
        });
        if (existingLicense) {
          throw new AppError(409, 'Bu lisans için ana sistem kurulumu daha önce tamamlanmış.', {
            errorCode: 'sso_license_already_provisioned',
          });
        }

        const plan = planCode ? await tx.plan.findUnique({ where: { code: planCode } }) : null;
        await tx.tenant.create({
          data: {
            id: tenantId,
            externalTenantId: setupRow.externalTenantId || null,
            name: storeName,
            slug: tenantSlug,
            status: 'active',
            payload: { source: 'getshelfio_sso' },
          },
        });
        await tx.store.create({
          data: {
            id: storeId,
            tenantId,
            name: storeName,
            code: 'SHF-001',
            status: 'active',
            payload: { source: 'getshelfio_sso' },
          },
        });
        await tx.license.create({
          data: {
            id: licenseId,
            tenantId,
            planId: plan?.id || null,
            planCode,
            licenseKeyHash: hashOpaqueValue(`external:${setupRow.externalLicenseId}`),
            externalLicenseId: setupRow.externalLicenseId,
            externalTenantId: setupRow.externalTenantId || null,
            licenseOwnerEmail: email,
            externalPlan: planCode,
            externalStatus: setupRow.licenseStatus,
            status: 'active',
            enabledModules: normalizePlanModules(planCode, tokenPayload.enabledModules, tokenPayload.screenAccess),
            storeLimit: toNullableInt(tokenPayload.storeLimit),
            userLimit: toNullableInt(tokenPayload.userLimit),
            expiresAt: toDateOrNull(tokenPayload.expiresAt),
            activatedAt: now,
            payload: {
              source: 'getshelfio_sso',
              licenseSummary: tokenPayload.licenseSummary || null,
              maskedKey: tokenPayload.licenseSummary?.maskedKey || undefined,
              licenseType: tokenPayload.licenseSummary?.licenseType || undefined,
              remainingDays: tokenPayload.licenseSummary?.remainingDays ?? undefined,
              screenAccess: tokenPayload.screenAccess || PLAN_PAGES[normalizePlanCode(planCode)] || null,
            },
          },
        });
        const user = await tx.user.create({
          data: {
            id: userId,
            tenantId,
            username: email,
            email,
            passwordHash,
            role: 'admin',
            name: adminName,
            storeId,
            isActive: true,
            createdAt: now,
            updatedAt: now,
            payload: {
              source: 'getshelfio_sso',
              owner: true,
              ...(phone ? { phone } : {}),
            },
          },
        });
        await tx.ssoSetupToken.update({
          where: { id: setupRow.id },
          data: { usedAt: now, localLicenseId: licenseId },
        });
        return { user, tenantId, storeId, licenseId };
      }));

      await auditRecorder({
        tenantId,
        userId,
        email,
        externalLicenseId: setupRow.externalLicenseId,
      });
      return provisioned;
    } catch (error) {
      if (error instanceof AppError) throw error;
      if (isUniqueConflict(error)) {
        throw new AppError(409, 'Bu lisans veya e-posta için ana sistem kurulumu daha önce tamamlanmış.', {
          errorCode: 'sso_license_already_provisioned',
        });
      }
      throw error;
    }
  },
});

export const ssoProvisioningService = createSsoProvisioningService();
