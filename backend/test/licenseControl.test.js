import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config/config.js';
import { licenseControlController } from '../src/controllers/licenseControlController.js';
import { ssoController } from '../src/controllers/ssoController.js';
import { authService } from '../src/services/authService.js';
import { getshelfioControlClient } from '../src/services/getshelfioControlClient.js';
import {
  getLicenseControlPublicState,
  isLicenseControlConfigured,
  isLicenseControlEnabled,
} from '../src/services/licenseControlConfig.js';
import { buildLicenseSummaryFromControlPayload } from '../src/services/licenseSummaryService.js';
import {
  ssoProvisioningService,
  normalizePlanCode,
  normalizePlanModules,
} from '../src/services/ssoProvisioningService.js';
import { AppError } from '../src/utils/appError.js';
import { userRepo } from '../src/repositories/userRepository.js';
import { licenseService } from '../src/services/licenseService.js';
import { licenseUsageService } from '../src/services/licenseUsageService.js';

const CONFIG_KEYS = [
  'getshelfioControlApiUrl',
  'getshelfioControlSecret',
  'shelfioLabsUsageSecret',
  'licenseControlEnabled',
  'licenseEnforcementMode',
  'licenseControlTimeoutMs',
];
const originalConfig = Object.fromEntries(CONFIG_KEYS.map((key) => [key, config[key]]));
const originalFetch = global.fetch;
const originalLoginWithSsoUser = authService.loginWithSsoUser;
const originalFindProvisionedLicense = ssoProvisioningService.findProvisionedLicense;
const originalCreateSetupChallenge = ssoProvisioningService.createSetupChallenge;
const originalWriteControlAudit = getshelfioControlClient.writeControlAudit;
const originalGetTenantUsage = licenseUsageService.getTenantUsage;

const restore = () => {
  Object.assign(config, originalConfig);
  global.fetch = originalFetch;
  authService.loginWithSsoUser = originalLoginWithSsoUser;
  ssoProvisioningService.findProvisionedLicense = originalFindProvisionedLicense;
  ssoProvisioningService.createSetupChallenge = originalCreateSetupChallenge;
  getshelfioControlClient.writeControlAudit = originalWriteControlAudit;
  licenseUsageService.getTenantUsage = originalGetTenantUsage;
};

const setShadowConfig = () => {
  Object.assign(config, {
    getshelfioControlApiUrl: 'https://control.example.test/api/control',
    getshelfioControlSecret: 'test-secret',
    licenseControlEnabled: true,
    licenseEnforcementMode: 'shadow',
    licenseControlTimeoutMs: 20,
  });
};

const jsonResponse = (status, payload) => ({
  ok: status >= 200 && status < 300,
  status,
  async text() {
    return JSON.stringify(payload);
  },
});

const invokeHealthController = async () => {
  const response = {
    statusCode: 0,
    payload: null,
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
  await licenseControlController.health({}, response);
  return response;
};

const invokeTenantUsageController = async ({ externalTenantId = 'tenant-ext-1', secret = '' } = {}) => {
  let nextError = null;
  const request = {
    params: { externalTenantId },
    get(header) {
      return header === 'X-Shelfio-Control-Secret' ? secret : undefined;
    },
  };
  const response = {
    payload: null,
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
  await licenseControlController.tenantUsage(request, response, (error) => {
    nextError = error;
  });
  return { nextError, response };
};

const invokeExportStatusController = async ({ jobId = 'job-1', secret = '' } = {}) => {
  let nextError = null;
  const request = {
    params: { jobId },
    get(header) {
      return header === 'X-Shelfio-Control-Secret' ? secret : undefined;
    },
  };
  const response = {
    payload: null,
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
  await licenseControlController.exportStatus(request, response, (error) => {
    nextError = error;
  });
  return { nextError, response };
};

const invokeSsoController = async (code) => {
  let nextError = null;
  const request = {
    body: { code },
    headers: {},
    ip: '127.0.0.1',
    socket: {},
  };
  const response = {
    payload: null,
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
  await ssoController.exchange(request, response, (error) => {
    nextError = error;
  });
  return { nextError, response };
};

test.afterEach(restore);

test('license control remains off unless enabled is boolean true and mode is valid', () => {
  Object.assign(config, {
    licenseControlEnabled: 'true',
    licenseEnforcementMode: 'shadow',
  });
  assert.equal(isLicenseControlEnabled(), false);

  Object.assign(config, {
    licenseControlEnabled: true,
    licenseEnforcementMode: 'unexpected',
  });
  assert.deepEqual(getLicenseControlPublicState(), {
    enabled: false,
    mode: 'off',
    configured: isLicenseControlConfigured(),
    failOpen: Boolean(config.licenseControlFailOpen),
  });
});

test('off mode health does not call the Control API', async () => {
  Object.assign(config, {
    licenseControlEnabled: false,
    licenseEnforcementMode: 'off',
  });
  global.fetch = async () => {
    throw new Error('fetch must not run in off mode');
  };

  const response = await invokeHealthController();

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.success, true);
  assert.equal(response.payload.mode, 'off');
  assert.equal(response.payload.enabled, false);
  assert.equal(response.payload.controlApiReachable, null);
});

test('shadow health survives an invalid Control API URL', async () => {
  setShadowConfig();
  config.getshelfioControlApiUrl = 'not-a-url';

  const response = await invokeHealthController();

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.success, true);
  assert.equal(response.payload.mode, 'shadow');
  assert.equal(response.payload.controlApiReachable, false);
  assert.equal(response.payload.lastErrorCode, 'control_unreachable');
});

test('shadow health skips the remote call when the secret is empty', async () => {
  setShadowConfig();
  config.getshelfioControlSecret = '';
  global.fetch = async () => {
    throw new Error('fetch must not run without a secret');
  };

  const response = await invokeHealthController();

  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.success, true);
  assert.equal(response.payload.configured, false);
  assert.equal(response.payload.controlApiReachable, null);
});

test('tenant usage controller returns the safe summary with the internal secret', async () => {
  const expected = { externalTenantId: 'tenant-ext-1', currentUserCount: 2, currentStoreCount: 1 };
  licenseUsageService.getTenantUsage = async (externalTenantId, secret) => {
    assert.equal(externalTenantId, 'tenant-ext-1');
    assert.equal(secret, 'inbound-secret');
    return expected;
  };

  const { nextError, response } = await invokeTenantUsageController({ secret: 'inbound-secret' });

  assert.equal(nextError, null);
  assert.deepEqual(response.payload, { success: true, data: expected });
});

test('export status rejects wrong internal secret', async () => {
  config.shelfioLabsUsageSecret = 'expected-secret';

  const { nextError, response } = await invokeExportStatusController({ secret: 'wrong-secret' });

  assert.equal(response.payload, null);
  assert.equal(nextError?.statusCode, 403);
  assert.equal(nextError?.errorCode, 'export_unauthorized');
});

test('Control API 401 and 403 responses are normalized', async () => {
  setShadowConfig();
  for (const status of [401, 403]) {
    global.fetch = async () => jsonResponse(status, { success: false });
    const result = await getshelfioControlClient.controlHealth();
    assert.deepEqual(result, {
      ok: false,
      reachable: false,
      errorCode: 'control_unauthorized',
      status,
    });
  }
});

test('Control API timeout is normalized', async () => {
  setShadowConfig();
  global.fetch = async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });

  const result = await getshelfioControlClient.controlHealth();

  assert.deepEqual(result, {
    ok: false,
    reachable: false,
    errorCode: 'control_timeout',
    status: 0,
  });
});

test('invalid Control API JSON is normalized', async () => {
  setShadowConfig();
  global.fetch = async () => ({
    ok: true,
    status: 200,
    async text() {
      return '{invalid-json';
    },
  });

  const result = await getshelfioControlClient.controlHealth();

  assert.deepEqual(result, {
    ok: false,
    reachable: false,
    errorCode: 'control_invalid_response',
    status: 0,
  });
});

test('Control payload license summary maps demo fields and excludes raw secrets', () => {
  const summary = buildLicenseSummaryFromControlPayload({
    plan: { id: 'plan-demo', slug: 'demo', name: 'Demo' },
    license: {
      id: 'license-ext-1',
      status: 'active',
      licenseType: 'demo',
      expiresAt: '2026-06-08T00:00:00.000Z',
      activatedAt: '2026-06-01T00:00:00.000Z',
      remainingDays: 7,
      enabledModules: ['stock', 'pos'],
      storeLimit: 1,
      userLimit: 3,
      maskedKey: 'SHF-****-DEMO',
      rawLicenseKey: 'must-not-leak',
    },
    code: 'must-not-leak',
    secret: 'must-not-leak',
  });

  assert.deepEqual(summary, {
    source: 'getshelfio',
    externalLicenseId: 'license-ext-1',
    externalTenantId: null,
    ownerEmail: null,
    planName: 'Demo',
    planSlug: 'demo',
    licenseType: 'demo',
    status: 'active',
    expiresAt: '2026-06-08T00:00:00.000Z',
    activatedAt: '2026-06-01T00:00:00.000Z',
    remainingDays: 7,
    isDemo: true,
    storeLimit: 1,
    userLimit: 3,
    enabledModules: ['stock', 'pos'],
    screenAccess: null,
    maskedKey: 'SHF-****-DEMO',
  });
  assert.equal(JSON.stringify(summary).includes('must-not-leak'), false);
});

test('SSO exchange rejects an empty code with controlled JSON middleware error', async () => {
  const { nextError } = await invokeSsoController('');

  assert.equal(nextError?.statusCode, 400);
  assert.equal(typeof nextError?.message, 'string');
});

test('SSO exchange normalizes an unreachable Control API', async () => {
  setShadowConfig();
  config.getshelfioControlApiUrl = 'not-a-url';

  const { nextError } = await invokeSsoController('one-time-code');

  assert.equal(nextError?.statusCode, 503);
  assert.equal(nextError?.errorCode, 'control_unreachable');
});

test('SSO exchange keeps automatic login for an existing local user', async () => {
  setShadowConfig();
  global.fetch = async () => jsonResponse(200, {
    success: true,
    data: {
      user: { email: 'owner@example.com' },
      owner: { email: 'owner@example.com' },
      license: { id: 'license-ext-1', status: 'active' },
    },
  });
  ssoProvisioningService.findProvisionedLicense = async () => null;
  authService.loginWithSsoUser = async () => ({ token: 'jwt', user: { email: 'owner@example.com' } });
  ssoProvisioningService.createSetupChallenge = async () => {
    throw new Error('setup challenge must not be created for an existing user');
  };
  getshelfioControlClient.writeControlAudit = async () => ({ ok: true });

  const { nextError, response } = await invokeSsoController('existing-user-code');

  assert.equal(nextError, null);
  assert.equal(response.payload.data.token, 'jwt');
});

test('SSO exchange returns setup required when the licensed owner has no local account', async () => {
  setShadowConfig();
  global.fetch = async () => jsonResponse(200, {
    success: true,
    data: {
      user: { email: 'owner@example.com' },
      owner: { email: 'owner@example.com' },
      license: { id: 'license-ext-1', status: 'active' },
    },
  });
  ssoProvisioningService.findProvisionedLicense = async () => null;
  authService.loginWithSsoUser = async () => {
    throw new AppError(403, 'Ana sistem hesabı henüz hazırlanmadı.', { errorCode: 'sso_account_missing' });
  };
  ssoProvisioningService.createSetupChallenge = async () => ({
    setupRequired: true,
    setupToken: 'one-time-token',
    email: 'owner@example.com',
  });
  getshelfioControlClient.writeControlAudit = async () => ({ ok: true });

  const { nextError, response } = await invokeSsoController('new-user-code');

  assert.equal(nextError, null);
  assert.equal(response.payload.data.setupRequired, true);
  assert.equal(response.payload.data.email, 'owner@example.com');
});

test('getCurrentUser queries getshelfio Control API dynamically when enabled and configured', async () => {
  setShadowConfig();
  let statusRequested = false;

  const originalGetLicenseStatus = getshelfioControlClient.getLicenseStatus;
  getshelfioControlClient.getLicenseStatus = async (opts) => {
    statusRequested = true;
    assert.equal(opts.email, 'test@example.com');
    return {
      ok: true,
      data: {
        license: { id: 'license-ext-1', status: 'active' },
        plan: { id: 'demo-plan', slug: 'demo', name: 'Demo Plan' },
        remainingDays: 5
      }
    };
  };

  const originalFindById = userRepo.findById;
  userRepo.findById = async (id) => ({
    id,
    username: 'test@example.com',
    email: 'test@example.com',
    isActive: true,
    role: 'admin',
    tenantId: 'tenant-1'
  });

  const originalResolve = licenseService.resolveAuthenticatedTenant;
  licenseService.resolveAuthenticatedTenant = async () => ({
    tenant: { id: 'tenant-1', name: 'Test' },
    activeStore: { id: 'store-1', name: 'Store' },
    license: { id: 'license-1', status: 'active' }
  });

  try {
    const result = await authService.getCurrentUser('user-1', { tenantId: 'tenant-1' });
    assert.equal(statusRequested, true);
    assert.equal(result.licenseSummary.planSlug, 'demo');
    assert.equal(result.licenseSummary.remainingDays, 5);
  } finally {
    getshelfioControlClient.getLicenseStatus = originalGetLicenseStatus;
    userRepo.findById = originalFindById;
    licenseService.resolveAuthenticatedTenant = originalResolve;
  }
});

test('normalizePlanCode normalizes variations of plan codes', () => {
  assert.equal(normalizePlanCode('pro'), 'pro');
  assert.equal(normalizePlanCode('professional'), 'pro');
  assert.equal(normalizePlanCode('profesyonel'), 'pro');
  assert.equal(normalizePlanCode('enterprise'), 'enterprise');
  assert.equal(normalizePlanCode('kurumsal'), 'enterprise');
  assert.equal(normalizePlanCode('demo'), 'demo');
  assert.equal(normalizePlanCode('starter'), 'starter');
  assert.equal(normalizePlanCode('standard'), 'starter');
  assert.equal(normalizePlanCode('standart'), 'starter');
  assert.equal(normalizePlanCode('UNKNOWN'), 'unknown');
});

test('normalizePlanModules guarantees default modules and merges incoming ones', () => {
  const proModules = normalizePlanModules('pro', ['stock', 'pos']);
  assert.equal(proModules.includes('reports'), true);
  assert.equal(proModules.includes('customers'), false);
  assert.equal(proModules.includes('stock'), true);
  assert.equal(proModules.includes('pos'), true);

  const kurumsalModules = normalizePlanModules('kurumsal', []);
  assert.equal(kurumsalModules.includes('products'), true);
  assert.equal(kurumsalModules.includes('pos'), true);
  assert.equal(kurumsalModules.includes('reports'), true);
  assert.equal(kurumsalModules.includes('customers'), true);
});
