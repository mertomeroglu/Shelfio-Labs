import { getPrisma } from '../providers/postgresProvider.js';
import { MAIN_STORE_ID, MAIN_TENANT_ID } from '../tenant/tenantContext.js';
import { hashLicenseKey, maskLicenseKey, normalizeLicenseKey } from '../utils/licenseKey.js';
import { PLAN_PAGES } from './ssoProvisioningService.js';

export const MAIN_SYSTEM_LICENSE_ID = 'license_main_shelfio_2026';
export const MAIN_SYSTEM_PLAN_ID = 'plan_enterprise_main';
export const DEFAULT_MAIN_SYSTEM_LICENSE_KEY = 'SHELFIO-MAIN-2026';

export const MAIN_SYSTEM_MODULES = [
  'dashboard',
  'products',
  'categories',
  'users',
  'settings',
  'pos',
  'stock',
  'permissions',
  'suppliers',
  'notifications',
  'warehouse',
  'stock_batches',
  'stock_movements',
  'tasks',
  'reports',
  'procurement',
  'purchase_orders',
  'campaigns',
  'proximity',
  'esl',
  'customers',
  'customer_mobile',
  'personnel_mobile',
  'support',
  'sales',
];

export const getMainSystemLicenseKey = () =>
  normalizeLicenseKey(process.env.MAIN_SYSTEM_LICENSE_KEY || DEFAULT_MAIN_SYSTEM_LICENSE_KEY);

export const isMainSystemLicenseKey = (value) =>
  hashLicenseKey(value) === hashLicenseKey(getMainSystemLicenseKey());

const buildLicenseSummary = (maskedKey) => ({
  source: 'shelfio_main',
  planName: 'Kurumsal / Platform',
  planSlug: 'enterprise',
  licenseType: 'main',
  status: 'active',
  isDemo: false,
  enabledModules: MAIN_SYSTEM_MODULES,
  screenAccess: PLAN_PAGES.enterprise,
  maskedKey,
});

export const ensureMainSystemLicense = async ({
  prisma: providedPrisma,
  licenseKey = getMainSystemLicenseKey(),
} = {}) => {
  const prisma = providedPrisma || await getPrisma();
  const normalizedKey = normalizeLicenseKey(licenseKey);
  const licenseKeyHash = hashLicenseKey(normalizedKey);
  const maskedKey = maskLicenseKey(normalizedKey);
  const licenseSummary = buildLicenseSummary(maskedKey);

  return prisma.$transaction(async (tx) => {
    await tx.tenant.upsert({
      where: { id: MAIN_TENANT_ID },
      create: {
        id: MAIN_TENANT_ID,
        name: 'Shelfio Ana Sistem',
        slug: 'main-shelfio',
        status: 'active',
        payload: { system: 'main' },
      },
      update: {
        status: 'active',
        payload: { system: 'main' },
      },
    });

    await tx.store.upsert({
      where: { id: MAIN_STORE_ID },
      create: {
        id: MAIN_STORE_ID,
        tenantId: MAIN_TENANT_ID,
        name: 'Ana Mağaza',
        code: 'MAIN',
        status: 'active',
        payload: { system: 'main' },
      },
      update: {
        tenantId: MAIN_TENANT_ID,
        status: 'active',
        payload: { system: 'main' },
      },
    });

    const existingPlan = await tx.plan.findUnique({ where: { code: 'enterprise' } });
    const planId = existingPlan?.id || MAIN_SYSTEM_PLAN_ID;
    await tx.plan.upsert({
      where: { id: planId },
      create: {
        id: planId,
        code: 'enterprise',
        name: 'Kurumsal / Platform',
        enabledModules: MAIN_SYSTEM_MODULES,
        payload: { system: 'main' },
      },
      update: {
        code: 'enterprise',
        name: 'Kurumsal / Platform',
        enabledModules: MAIN_SYSTEM_MODULES,
        storeLimit: null,
        userLimit: null,
        payload: { system: 'main' },
      },
    });

    const existingByHash = await tx.license.findUnique({ where: { licenseKeyHash } });
    const licenseId = existingByHash?.id || MAIN_SYSTEM_LICENSE_ID;
    const data = {
      tenantId: MAIN_TENANT_ID,
      planId,
      planCode: 'enterprise',
      licenseKeyHash,
      externalLicenseId: null,
      externalTenantId: null,
      licenseOwnerEmail: null,
      externalPlan: null,
      externalStatus: null,
      status: 'active',
      enabledModules: MAIN_SYSTEM_MODULES,
      storeLimit: null,
      userLimit: null,
      expiresAt: null,
      payload: {
        system: 'main',
        maskedKey,
        licenseType: 'main',
        screenAccess: PLAN_PAGES.enterprise,
        licenseSummary,
      },
    };

    return tx.license.upsert({
      where: { id: licenseId },
      create: {
        id: licenseId,
        ...data,
        activatedAt: new Date(),
      },
      update: data,
      include: {
        tenant: true,
        plan: true,
      },
    });
  });
};
