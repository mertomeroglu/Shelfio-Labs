import { getPrisma } from '../providers/postgresProvider.js';
import { runWithTenantContext } from '../tenant/tenantContext.js';
import { AppError } from '../utils/appError.js';
import { assertShelfioControlSecret } from './internalControlAuth.js';
import { buildLicenseSummaryFromDbLicense } from './licenseSummaryService.js';

const cleanText = (value, max = 180) => String(value || '').trim().slice(0, max);

const findMappedTenant = async (prisma, externalTenantId) => {
  const tenant = await prisma.tenant.findUnique({
    where: { externalTenantId },
  });
  if (tenant) {
    const license = await prisma.license.findFirst({
      where: { tenantId: tenant.id },
      include: { plan: true },
      orderBy: { createdAt: 'desc' },
    });
    return { tenant, license };
  }

  const license = await prisma.license.findFirst({
    where: {
      OR: [
        { externalTenantId },
        { externalLicenseId: externalTenantId },
      ],
    },
    include: { tenant: true, plan: true },
    orderBy: { createdAt: 'desc' },
  });

  return license?.tenant ? { tenant: license.tenant, license } : null;
};

export const createLicenseUsageService = ({
  getPrismaClient = getPrisma,
} = {}) => ({
  async getTenantUsage(externalTenantId, providedSecret) {
    assertShelfioControlSecret(providedSecret);

    const mappingId = cleanText(externalTenantId);
    if (!mappingId) {
      throw new AppError(400, 'External tenant kimligi zorunludur.', { errorCode: 'external_tenant_id_required' });
    }

    const prisma = await getPrismaClient();
    const mapped = await findMappedTenant(prisma, mappingId);
    if (!mapped) {
      throw new AppError(404, 'Tenant mapping bulunamadi.', { errorCode: 'tenant_mapping_not_found' });
    }

    const { tenant, license } = mapped;
    const usage = await runWithTenantContext({ tenantId: tenant.id }, async () => {
      const [
        currentUserCount,
        activeUserCount,
        currentStoreCount,
        activeStoreCount,
        adminUser,
        activity,
      ] = await Promise.all([
        prisma.user.count({ where: { tenantId: tenant.id } }),
        prisma.user.count({ where: { tenantId: tenant.id, isActive: true } }),
        prisma.store.count({ where: { tenantId: tenant.id } }),
        prisma.store.count({ where: { tenantId: tenant.id, status: 'active' } }),
        prisma.user.findFirst({
          where: { tenantId: tenant.id, role: 'admin', isActive: true },
          select: { email: true },
          orderBy: { createdAt: 'asc' },
        }),
        prisma.user.aggregate({
          where: { tenantId: tenant.id },
          _max: { lastLoginAt: true },
        }),
      ]);

      return {
        currentUserCount,
        activeUserCount,
        currentStoreCount,
        activeStoreCount,
        adminEmail: license?.licenseOwnerEmail || adminUser?.email || null,
        lastActivityAt: activity?._max?.lastLoginAt || null,
      };
    });

    const summary = buildLicenseSummaryFromDbLicense(license || {});
    return {
      externalTenantId: tenant.externalTenantId || license?.externalTenantId || mappingId,
      externalLicenseId: license?.externalLicenseId || null,
      tenantId: tenant.id,
      tenantName: tenant.name,
      ...usage,
      licenseStatus: license?.externalStatus || license?.status || null,
      planSlug: summary.planSlug,
      planName: summary.planName,
      licenseType: summary.licenseType,
      expiresAt: summary.expiresAt,
      remainingDays: summary.remainingDays,
    };
  },
});

export const licenseUsageService = createLicenseUsageService();
