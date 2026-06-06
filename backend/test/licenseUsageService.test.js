import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config/config.js';
import { createLicenseUsageService } from '../src/services/licenseUsageService.js';

const originalUsageSecret = config.shelfioLabsUsageSecret;

test.afterEach(() => {
  config.shelfioLabsUsageSecret = originalUsageSecret;
});

const createPrismaMock = ({ directTenant = true, fallbackLicense = true } = {}) => {
  const calls = [];
  const tenant = {
    id: 'tenant-local-1',
    externalTenantId: directTenant ? 'tenant-ext-1' : null,
    name: 'Example Store',
  };
  const license = {
    id: 'license-local-1',
    tenantId: tenant.id,
    externalTenantId: 'tenant-ext-1',
    externalLicenseId: 'license-ext-1',
    licenseOwnerEmail: 'owner@example.com',
    licenseKeyHash: 'must-not-leak-hash',
    externalStatus: 'active',
    status: 'active',
    planCode: 'demo',
    externalPlan: 'demo',
    expiresAt: new Date('2026-06-08T00:00:00.000Z'),
    payload: {
      secret: 'must-not-leak-secret',
      token: 'must-not-leak-token',
      licenseSummary: {
        planSlug: 'demo',
        planName: 'Demo',
        licenseType: 'demo',
        remainingDays: 6,
      },
    },
    plan: { code: 'demo', name: 'Demo' },
    tenant,
  };

  return {
    calls,
    tenant: {
      async findUnique(args) {
        calls.push(['tenant.findUnique', args]);
        return directTenant ? tenant : null;
      },
    },
    license: {
      async findFirst(args) {
        calls.push(['license.findFirst', args]);
        return directTenant || fallbackLicense ? license : null;
      },
    },
    user: {
      async count(args) {
        calls.push(['user.count', args]);
        return args.where.isActive === true ? 2 : 3;
      },
      async findFirst(args) {
        calls.push(['user.findFirst', args]);
        return { email: 'admin@example.com' };
      },
      async aggregate(args) {
        calls.push(['user.aggregate', args]);
        return { _max: { lastLoginAt: new Date('2026-06-02T08:00:00.000Z') } };
      },
    },
    store: {
      async count(args) {
        calls.push(['store.count', args]);
        return args.where.status === 'active' ? 1 : 2;
      },
    },
  };
};

test('usage summary counts tenant rows, excludes disabled users from active count and leaks no secrets', async () => {
  config.shelfioLabsUsageSecret = 'inbound-secret';
  const prisma = createPrismaMock();
  const service = createLicenseUsageService({ getPrismaClient: async () => prisma });

  const result = await service.getTenantUsage('tenant-ext-1', 'inbound-secret');

  assert.equal(result.currentUserCount, 3);
  assert.equal(result.activeUserCount, 2);
  assert.equal(result.currentStoreCount, 2);
  assert.equal(result.activeStoreCount, 1);
  assert.equal(result.adminEmail, 'owner@example.com');
  assert.equal(result.planSlug, 'demo');
  assert.equal(result.remainingDays, 6);
  assert.equal(JSON.stringify(result).includes('must-not-leak'), false);
  assert.deepEqual(
    Object.keys(result),
    [
      'externalTenantId',
      'externalLicenseId',
      'tenantId',
      'tenantName',
      'currentUserCount',
      'activeUserCount',
      'currentStoreCount',
      'activeStoreCount',
      'adminEmail',
      'lastActivityAt',
      'licenseStatus',
      'planSlug',
      'planName',
      'licenseType',
      'expiresAt',
      'remainingDays',
    ],
  );
});

test('usage summary falls back to license external mapping without exposing another tenant', async () => {
  config.shelfioLabsUsageSecret = 'inbound-secret';
  const prisma = createPrismaMock({ directTenant: false });
  const service = createLicenseUsageService({ getPrismaClient: async () => prisma });

  const result = await service.getTenantUsage('tenant-ext-1', 'inbound-secret');

  assert.equal(result.tenantId, 'tenant-local-1');
  assert.deepEqual(prisma.calls[1], [
    'license.findFirst',
    {
      where: {
        OR: [
          { externalTenantId: 'tenant-ext-1' },
          { externalLicenseId: 'tenant-ext-1' },
        ],
      },
      include: { tenant: true, plan: true },
      orderBy: { createdAt: 'desc' },
    },
  ]);
});

test('usage summary rejects missing, incorrect and unmapped internal requests', async () => {
  const prisma = createPrismaMock({ directTenant: false, fallbackLicense: false });
  const service = createLicenseUsageService({ getPrismaClient: async () => prisma });

  await assert.rejects(
    () => service.getTenantUsage('tenant-ext-1', 'any-secret'),
    (error) => error.statusCode === 503 && error.errorCode === 'usage_secret_not_configured',
  );

  config.shelfioLabsUsageSecret = 'inbound-secret';
  await assert.rejects(
    () => service.getTenantUsage('tenant-ext-1', 'wrong-secret'),
    (error) => error.statusCode === 403 && error.errorCode === 'usage_unauthorized',
  );
  await assert.rejects(
    () => service.getTenantUsage('tenant-ext-1', 'inbound-secret'),
    (error) => error.statusCode === 404 && error.errorCode === 'tenant_mapping_not_found',
  );
});
