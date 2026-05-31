import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config/config.js';
import { licenseControlController } from '../src/controllers/licenseControlController.js';
import { ssoController } from '../src/controllers/ssoController.js';
import { getshelfioControlClient } from '../src/services/getshelfioControlClient.js';
import {
  getLicenseControlPublicState,
  isLicenseControlConfigured,
  isLicenseControlEnabled,
} from '../src/services/licenseControlConfig.js';

const CONFIG_KEYS = [
  'getshelfioControlApiUrl',
  'getshelfioControlSecret',
  'licenseControlEnabled',
  'licenseEnforcementMode',
  'licenseControlTimeoutMs',
];
const originalConfig = Object.fromEntries(CONFIG_KEYS.map((key) => [key, config[key]]));
const originalFetch = global.fetch;

const restore = () => {
  Object.assign(config, originalConfig);
  global.fetch = originalFetch;
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
