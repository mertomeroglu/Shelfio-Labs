import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertActiveSsoProvisioningContext,
  createSsoProvisioningService,
  extractSsoProvisioningContext,
} from '../src/services/ssoProvisioningService.js';
import { getshelfioControlClient } from '../src/services/getshelfioControlClient.js';
import { validateSsoPassword } from '../src/utils/ssoPasswordPolicy.js';

const createUniqueError = () => Object.assign(new Error('unique conflict'), { code: 'P2002' });

test('SSO setup password policy accepts Unicode letters and broad special characters', () => {
  assert.equal(validateSsoPassword('Password1!'), true);
  assert.equal(validateSsoPassword('Password1.'), true);
  assert.equal(validateSsoPassword('Şifre123!'), true);
  assert.equal(validateSsoPassword('password1!'), false);
  assert.equal(validateSsoPassword('Password!'), false);
});

const createFakePrisma = () => {
  const rows = {
    tenants: [],
    stores: [],
    licenses: [],
    users: [],
    setupTokens: [],
  };

  const prisma = {
    rows,
    license: {
      async findUnique({ where }) {
        if (where.externalLicenseId) return rows.licenses.find((row) => row.externalLicenseId === where.externalLicenseId) || null;
        return null;
      },
      async create({ data }) {
        if (rows.licenses.some((row) => row.externalLicenseId === data.externalLicenseId)) throw createUniqueError();
        rows.licenses.push({ ...data });
        return data;
      },
    },
    tenant: {
      async create({ data }) {
        rows.tenants.push({ ...data });
        return data;
      },
    },
    store: {
      async create({ data }) {
        rows.stores.push({ ...data });
        return data;
      },
    },
    plan: {
      async findUnique() {
        return null;
      },
    },
    user: {
      async create({ data }) {
        if (rows.users.some((row) => row.username === data.username)) throw createUniqueError();
        rows.users.push({ ...data });
        return data;
      },
    },
    ssoSetupToken: {
      async create({ data }) {
        if (rows.setupTokens.some((row) => row.tokenHash === data.tokenHash || row.exchangeCodeHash === data.exchangeCodeHash)) {
          throw createUniqueError();
        }
        rows.setupTokens.push({ ...data });
        return data;
      },
      async findUnique({ where }) {
        return rows.setupTokens.find((row) => row.tokenHash === where.tokenHash) || null;
      },
      async update({ where, data }) {
        const row = rows.setupTokens.find((item) => item.id === where.id);
        Object.assign(row, data);
        return row;
      },
    },
    async $transaction(callback) {
      return callback(prisma);
    },
  };

  return prisma;
};

const activeContext = () => ({
  externalLicenseId: 'license-ext-1',
  externalTenantId: 'tenant-ext-1',
  ownerEmail: 'owner@example.com',
  userEmail: 'owner@example.com',
  status: 'active',
  planCode: 'business',
  enabledModules: ['products', 'stock'],
  storeLimit: 1,
  userLimit: 10,
  expiresAt: new Date(Date.now() + 60_000),
});

test('extracts and validates active owner license context', () => {
  const context = extractSsoProvisioningContext({
    user: { email: 'OWNER@example.com' },
    owner: { email: 'owner@example.com' },
    tenant: { id: 'tenant-ext-1' },
    license: {
      id: 'license-ext-1',
      status: 'active',
      modules: ['products'],
      limits: { stores: 1, users: 5 },
    },
  });

  assert.equal(assertActiveSsoProvisioningContext(context), context);
  assert.equal(context.ownerEmail, 'owner@example.com');
  assert.equal(context.externalLicenseId, 'license-ext-1');
});

test('rejects inactive licenses and owner email mismatches', () => {
  assert.throws(
    () => assertActiveSsoProvisioningContext({ ...activeContext(), status: 'expired' }),
    (error) => error.errorCode === 'license_expired',
  );
  assert.throws(
    () => assertActiveSsoProvisioningContext({ ...activeContext(), userEmail: 'other@example.com' }),
    (error) => error.errorCode === 'sso_owner_mismatch',
  );
});

test('extracts active license from supported SSO payload shapes', () => {
  const proFromDataLicense = extractSsoProvisioningContext({
    data: {
      user: { email: 'owner@example.com' },
      tenant: { id: 'tenant-ext-1' },
      plan: { slug: 'pro', name: 'Pro' },
      license: {
        id: 'license-ext-1',
        status: 'active',
        licenseType: 'standard',
      },
    },
  });

  assert.equal(assertActiveSsoProvisioningContext(proFromDataLicense), proFromDataLicense);
  assert.equal(proFromDataLicense.externalLicenseId, 'license-ext-1');
  assert.equal(proFromDataLicense.planCode, 'pro');

  const demoFromEntitlements = extractSsoProvisioningContext({
    account: { email: 'owner@example.com' },
    entitlements: [{
      id: 'license-ext-demo',
      status: 'active',
      licenseType: 'demo',
      plan: { slug: 'demo', name: 'Demo' },
      remainingDays: 7,
      enabledModules: ['stock'],
    }],
  });

  assert.equal(assertActiveSsoProvisioningContext(demoFromEntitlements), demoFromEntitlements);
  assert.equal(demoFromEntitlements.externalLicenseId, 'license-ext-demo');
  assert.equal(demoFromEntitlements.isDemo, true);
  assert.equal(demoFromEntitlements.remainingDays, 7);
});

test('rejects expired demo and pending payloads with public error codes', () => {
  const expiredDemo = extractSsoProvisioningContext({
    user: { email: 'owner@example.com' },
    license: {
      id: 'license-ext-demo',
      status: 'active',
      licenseType: 'demo',
      remainingDays: -1,
    },
  });
  assert.throws(
    () => assertActiveSsoProvisioningContext(expiredDemo),
    (error) => error.errorCode === 'license_expired',
  );

  const pendingLicense = extractSsoProvisioningContext({
    user: { email: 'owner@example.com' },
    license: {
      id: 'license-ext-pending',
      status: 'pending',
    },
  });
  assert.throws(
    () => assertActiveSsoProvisioningContext(pendingLicense),
    (error) => error.errorCode === 'license_not_active',
  );
});

test('creates tenant, store, mapped license and hashed admin account from one-time setup token', async () => {
  const prisma = createFakePrisma();
  const service = createSsoProvisioningService({
    getPrismaClient: async () => prisma,
    passwordHasher: async () => 'hashed-password',
    auditRecorder: async () => {},
  });
  const challenge = await service.createSetupChallenge({ exchangeCode: 'sso-code-1', context: activeContext() });

  assert.equal(challenge.setupRequired, true);
  assert.equal(challenge.email, 'owner@example.com');
  assert.notEqual(prisma.rows.setupTokens[0].tokenHash, challenge.setupToken);

  const result = await service.setupTenantAdmin({
    setupToken: challenge.setupToken,
    email: challenge.email,
    adminName: 'Example Owner',
    storeName: 'Example Market',
    phone: '5551112233',
    password: 'Strong!1A',
    passwordConfirm: 'Strong!1A',
  });

  assert.equal(prisma.rows.tenants.length, 1);
  assert.equal(prisma.rows.stores[0].code, 'SHF-001');
  assert.equal(prisma.rows.licenses[0].externalLicenseId, 'license-ext-1');
  assert.equal(prisma.rows.users[0].role, 'admin');
  assert.equal(prisma.rows.users[0].passwordHash, 'hashed-password');
  assert.equal(JSON.stringify(prisma.rows).includes('Strong!1A'), false);
  assert.equal(result.tenantId, prisma.rows.tenants[0].id);
});

test('rejects reused setup tokens, replayed SSO codes and a second tenant for one license', async () => {
  const prisma = createFakePrisma();
  const service = createSsoProvisioningService({
    getPrismaClient: async () => prisma,
    passwordHasher: async () => 'hashed-password',
    auditRecorder: async () => {},
  });
  const first = await service.createSetupChallenge({ exchangeCode: 'sso-code-1', context: activeContext() });
  const form = {
    email: first.email,
    adminName: 'Example Owner',
    storeName: 'Example Market',
    password: 'Strong!1A',
    passwordConfirm: 'Strong!1A',
  };
  await service.setupTenantAdmin({ ...form, setupToken: first.setupToken });

  await assert.rejects(
    () => service.setupTenantAdmin({ ...form, setupToken: first.setupToken }),
    (error) => error.errorCode === 'sso_setup_token_invalid',
  );
  await assert.rejects(
    () => service.createSetupChallenge({ exchangeCode: 'sso-code-1', context: { ...activeContext(), externalLicenseId: 'license-ext-2' } }),
    (error) => error.errorCode === 'sso_code_already_used',
  );

  const second = await service.createSetupChallenge({ exchangeCode: 'sso-code-2', context: activeContext() });
  await assert.rejects(
    () => service.setupTenantAdmin({ ...form, setupToken: second.setupToken }),
    (error) => error.errorCode === 'sso_license_already_provisioned',
  );
  assert.equal(prisma.rows.tenants.length, 1);
});

test('rejects expired setup tokens with a controlled error', async () => {
  const prisma = createFakePrisma();
  const service = createSsoProvisioningService({
    getPrismaClient: async () => prisma,
    passwordHasher: async () => 'hashed-password',
    auditRecorder: async () => {},
  });
  const challenge = await service.createSetupChallenge({ exchangeCode: 'expired-code', context: activeContext() });
  prisma.rows.setupTokens[0].expiresAt = new Date(Date.now() - 1000);

  await assert.rejects(
    () => service.setupTenantAdmin({
      setupToken: challenge.setupToken,
      email: challenge.email,
      adminName: 'Example Owner',
      storeName: 'Example Market',
      password: 'Strong!1A',
      passwordConfirm: 'Strong!1A',
    }),
    (error) => error.errorCode === 'sso_setup_token_invalid',
  );
});

test('rejects weak SSO setup passwords with a controlled error code', async () => {
  const prisma = createFakePrisma();
  const service = createSsoProvisioningService({
    getPrismaClient: async () => prisma,
    passwordHasher: async () => 'hashed-password',
    auditRecorder: async () => {},
  });
  const challenge = await service.createSetupChallenge({ exchangeCode: 'weak-password-code', context: activeContext() });

  await assert.rejects(
    () => service.setupTenantAdmin({
      setupToken: challenge.setupToken,
      email: challenge.email,
      adminName: 'Example Owner',
      storeName: 'Example Market',
      password: 'password1!',
      passwordConfirm: 'password1!',
    }),
    (error) => error.errorCode === 'weak_password',
  );
});

test('accepts Turkish letters during SSO setup password validation', async () => {
  const prisma = createFakePrisma();
  const service = createSsoProvisioningService({
    getPrismaClient: async () => prisma,
    passwordHasher: async () => 'hashed-password',
    auditRecorder: async () => {},
  });
  const challenge = await service.createSetupChallenge({ exchangeCode: 'unicode-password-code', context: activeContext() });

  await service.setupTenantAdmin({
    setupToken: challenge.setupToken,
    email: challenge.email,
    adminName: 'Example Owner',
    storeName: 'Example Market',
    password: 'Şifre123!',
    passwordConfirm: 'Şifre123!',
  });

  assert.equal(prisma.rows.users.length, 1);
});

test('masks SSO secrets and passwords before control audit logging', () => {
  assert.deepEqual(
    getshelfioControlClient.sanitizeForLog({
      code: 'short-lived-code',
      setupToken: 'raw-setup-token',
      password: 'Strong!1A',
      secret: 'control-secret',
      nested: { refreshToken: 'refresh-token' },
    }),
    {
      code: '***',
      setupToken: '***',
      password: '***',
      secret: '***',
      nested: { refreshToken: '***' },
    },
  );
});
