import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  DEFAULT_MAIN_SYSTEM_LICENSE_KEY,
  MAIN_SYSTEM_LICENSE_ID,
  MAIN_SYSTEM_MODULES,
  ensureMainSystemLicense,
  isMainSystemLicenseKey,
} from '../src/services/mainSystemLicenseService.js';
import { hashLicenseKey, maskLicenseKey } from '../src/utils/licenseKey.js';

const testDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(testDir, '..', '..');
const readProjectFile = (path) => readFileSync(resolve(projectRoot, path), 'utf8');

const createFakePrisma = () => {
  const rows = {
    tenants: [],
    stores: [],
    plans: [],
    licenses: [],
  };

  const upsertById = (list) => async ({ where, create, update }) => {
    const row = list.find((item) => item.id === where.id);
    if (row) {
      Object.assign(row, update);
      return row;
    }
    const created = { ...create };
    list.push(created);
    return created;
  };

  const prisma = {
    rows,
    tenant: { upsert: upsertById(rows.tenants) },
    store: { upsert: upsertById(rows.stores) },
    plan: {
      async findUnique({ where }) {
        return rows.plans.find((row) => row.code === where.code) || null;
      },
      upsert: upsertById(rows.plans),
    },
    license: {
      async findUnique({ where }) {
        if (where.licenseKeyHash) {
          return rows.licenses.find((row) => row.licenseKeyHash === where.licenseKeyHash) || null;
        }
        return rows.licenses.find((row) => row.id === where.id) || null;
      },
      upsert: upsertById(rows.licenses),
    },
    async $transaction(callback) {
      return callback(prisma);
    },
  };

  return prisma;
};

test('main license key uses normalized SHA-256 hash and safe mask', () => {
  assert.equal(
    hashLicenseKey(DEFAULT_MAIN_SYSTEM_LICENSE_KEY),
    'f8d3d76711199d1a87a0ad2ebc5343f6ed8339e54ceea16cc5d54e616534b8ef'
  );
  assert.equal(maskLicenseKey(DEFAULT_MAIN_SYSTEM_LICENSE_KEY), 'SHELFIO-****-2026');
  assert.equal(isMainSystemLicenseKey(' shelfio-main-2026 '), true);
});

test('main license ensure is idempotent and stores no raw key', async () => {
  const prisma = createFakePrisma();

  await ensureMainSystemLicense({ prisma });
  await ensureMainSystemLicense({ prisma });

  assert.equal(prisma.rows.tenants.length, 1);
  assert.equal(prisma.rows.stores.length, 1);
  assert.equal(prisma.rows.plans.length, 1);
  assert.equal(prisma.rows.licenses.length, 1);

  const license = prisma.rows.licenses[0];
  assert.equal(license.id, MAIN_SYSTEM_LICENSE_ID);
  assert.equal(license.tenantId, 'tenant_main_shelfio');
  assert.equal(license.status, 'active');
  assert.equal(license.expiresAt, null);
  assert.equal(license.externalLicenseId, null);
  assert.equal(license.payload.maskedKey, 'SHELFIO-****-2026');
  assert.equal(JSON.stringify(license).includes(DEFAULT_MAIN_SYSTEM_LICENSE_KEY), false);
  assert.deepEqual(license.enabledModules, MAIN_SYSTEM_MODULES);
});

test('local verify ensures only the main key and never returns payload label', () => {
  const service = readProjectFile('backend/src/services/licenseService.js');

  assert.match(service, /if \(isMainSystemLicenseKey\(licenseKey\)\)/);
  assert.match(service, /await ensureMainSystemLicense\(\{ prisma, licenseKey \}\)/);
  assert.doesNotMatch(service, /payload\?\.label/);
});

test('repair script logs only a masked key and migration clears legacy raw payload', () => {
  const script = readProjectFile('backend/scripts/repair/ensureMainSystemLicense.js');
  const migration = readProjectFile(
    'backend/prisma/migrations/20260601103000_secure_main_system_license/migration.sql'
  );

  assert.match(script, /maskLicenseKey\(licenseKey\)/);
  assert.doesNotMatch(script, /\$\{licenseKey\}/);
  assert.match(migration, /"maskedKey":"SHELFIO-\*\*\*\*-2026"/);
  assert.doesNotMatch(migration, /"label":"SHELFIO-MAIN-2026"/);
});
