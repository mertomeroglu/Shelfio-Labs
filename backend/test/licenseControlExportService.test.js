import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { config } from '../src/config/config.js';
import {
  createLicenseControlExportService,
  redactSensitiveJson,
  EXPORT_STATUS,
} from '../src/services/licenseControlExportService.js';

const originalConfig = {
  exportStorageDir: config.exportStorageDir,
  publicApiBaseUrl: config.publicApiBaseUrl,
};

test.afterEach(() => {
  Object.assign(config, originalConfig);
});

const createPrismaMock = () => {
  const rows = { exportJobs: [] };
  const tenant = {
    id: 'tenant-local-1',
    externalTenantId: 'tenant-ext-1',
    name: 'Tenant One',
  };
  const license = {
    id: 'license-local-1',
    tenantId: tenant.id,
    externalLicenseId: 'license-ext-1',
    externalTenantId: 'tenant-ext-1',
    externalStatus: 'active',
    status: 'active',
    tenant,
  };

  return {
    rows,
    tenant,
    license,
    license: {
      async findUnique({ where }) {
        if (where.externalLicenseId === license.externalLicenseId || where.id === license.id) return license;
        return null;
      },
    },
    exportJob: {
      async create({ data }) {
        const row = {
          ...data,
          createdAt: new Date('2026-06-03T10:00:00.000Z'),
          updatedAt: new Date('2026-06-03T10:00:00.000Z'),
          downloadCount: data.downloadCount ?? 0,
        };
        rows.exportJobs.push(row);
        return row;
      },
      async findUnique({ where }) {
        if (where.id) return rows.exportJobs.find((row) => row.id === where.id) || null;
        if (where.downloadTokenHash) return rows.exportJobs.find((row) => row.downloadTokenHash === where.downloadTokenHash) || null;
        return null;
      },
      async findMany() {
        return rows.exportJobs.filter((row) => row.status === EXPORT_STATUS.READY);
      },
      async update({ where, data }) {
        const row = rows.exportJobs.find((item) => item.id === where.id);
        if (!row) return null;
        Object.entries(data).forEach(([key, value]) => {
          if (value && typeof value === 'object' && 'increment' in value) {
            row[key] = Number(row[key] || 0) + Number(value.increment || 0);
          } else {
            row[key] = value;
          }
        });
        row.updatedAt = new Date();
        return row;
      },
    },
  };
};

test('redacts sensitive keys recursively without dropping safe payload data', () => {
  const redacted = redactSensitiveJson({
    visible: 'ok',
    nested: {
      accessToken: 'raw-token',
      apiKey: 'raw-key',
      items: [{ pinCode: '1234', label: 'kept' }],
    },
  });

  assert.deepEqual(redacted, {
    visible: 'ok',
    nested: {
      accessToken: '[REDACTED]',
      apiKey: '[REDACTED]',
      items: [{ pinCode: '[REDACTED]', label: 'kept' }],
    },
  });
});

test('creates tenant-scoped export job by externalLicenseId and rejects tenant mismatch', async () => {
  config.publicApiBaseUrl = 'https://shelfiolabs.com';
  const prisma = createPrismaMock();
  const service = createLicenseControlExportService({
    getPrismaClient: async () => prisma,
    schedule: () => {},
  });

  const result = await service.createExport({
    externalLicenseId: 'license-ext-1',
    externalTenantId: 'tenant-ext-1',
    requestedByEmail: 'OWNER@EXAMPLE.COM',
  });

  assert.equal(result.status, EXPORT_STATUS.QUEUED);
  assert.match(result.downloadUrl, /^https:\/\/shelfiolabs\.com\/api\/license-control\/exports\/download\//);
  assert.equal(prisma.rows.exportJobs[0].tenantId, 'tenant-local-1');
  assert.equal(prisma.rows.exportJobs[0].licenseId, 'license-local-1');
  assert.equal(prisma.rows.exportJobs[0].requestedByEmail, 'owner@example.com');
  assert.notEqual(prisma.rows.exportJobs[0].downloadTokenHash, result.downloadUrl.split('/').at(-1));

  await assert.rejects(
    () => service.createExport({ externalLicenseId: 'license-ext-1', externalTenantId: 'other-tenant' }),
    (error) => error.statusCode === 403 && error.errorCode === 'external_tenant_mismatch',
  );
});

test('status returns public download URL only when export is ready', async () => {
  config.publicApiBaseUrl = 'https://shelfiolabs.com';
  const prisma = createPrismaMock();
  const service = createLicenseControlExportService({
    getPrismaClient: async () => prisma,
    schedule: () => {},
  });

  const created = await service.createExport({
    externalLicenseId: 'license-ext-1',
    externalTenantId: 'tenant-ext-1',
  });
  assert.equal((await service.getStatus(created.jobId)).downloadUrl, null);

  prisma.rows.exportJobs[0].status = EXPORT_STATUS.READY;
  prisma.rows.exportJobs[0].fileName = 'shelfio-magaza-verileri-2026-06-03.xlsx';
  prisma.rows.exportJobs[0].downloadExpiresAt = new Date(Date.now() + 60_000);

  const readyStatus = await service.getStatus(created.jobId);

  assert.match(readyStatus.downloadUrl, /^https:\/\/shelfiolabs\.com\/api\/license-control\/exports\/download\//);
  assert.equal(readyStatus.fileBasename, undefined);
  assert.notEqual(prisma.rows.exportJobs[0].downloadTokenHash, readyStatus.downloadUrl.split('/').at(-1));
});

test('ready status can recreate provider download URL without in-memory raw token', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'shelfio-export-provider-test-'));
  config.exportStorageDir = tempDir;
  config.publicApiBaseUrl = 'https://shelfiolabs.com';
  const prisma = createPrismaMock();
  const service = createLicenseControlExportService({
    getPrismaClient: async () => prisma,
    schedule: () => {},
  });

  const safeFile = 'tenant-export-provider.xlsx';
  await writeFile(path.join(tempDir, safeFile), 'xlsx-bytes');
  prisma.rows.exportJobs.push({
    id: 'job-ready-provider',
    tenantId: 'tenant-local-1',
    externalLicenseId: 'license-ext-1',
    status: EXPORT_STATUS.READY,
    scope: 'tenant',
    fileName: 'shelfio-magaza-verileri-2026-06-03.xlsx',
    fileBasename: safeFile,
    downloadTokenHash: 'legacy-random-token-hash',
    downloadExpiresAt: new Date(Date.now() + 60_000),
    downloadCount: 0,
    createdAt: new Date('2026-06-03T10:00:00.000Z'),
  });

  const readyStatus = await service.getStatus('job-ready-provider');
  const providerToken = readyStatus.downloadUrl.split('/').at(-1);

  assert.match(readyStatus.downloadUrl, /^https:\/\/shelfiolabs\.com\/api\/license-control\/exports\/download\//);
  assert.doesNotMatch(readyStatus.downloadUrl, /localhost/i);
  assert.notEqual(prisma.rows.exportJobs[0].downloadTokenHash, providerToken);

  const downloaded = await service.downloadByToken(providerToken);
  assert.equal(downloaded.buffer.toString(), 'xlsx-bytes');
  assert.equal(prisma.rows.exportJobs[0].downloadCount, 1);

  await rm(tempDir, { recursive: true, force: true });
});

test('expired provider download token returns 410', async () => {
  config.publicApiBaseUrl = 'https://shelfiolabs.com';
  const prisma = createPrismaMock();
  const service = createLicenseControlExportService({
    getPrismaClient: async () => prisma,
    schedule: () => {},
  });

  prisma.rows.exportJobs.push({
    id: 'job-expired-provider',
    tenantId: 'tenant-local-1',
    externalLicenseId: 'license-ext-1',
    status: EXPORT_STATUS.READY,
    scope: 'tenant',
    fileName: 'shelfio-magaza-verileri-2026-06-03.xlsx',
    fileBasename: 'tenant-export-expired.xlsx',
    downloadTokenHash: 'legacy-random-token-hash',
    downloadExpiresAt: new Date(Date.now() - 60_000),
    downloadCount: 0,
    createdAt: new Date('2026-06-03T10:00:00.000Z'),
  });

  const readyStatus = await service.getStatus('job-expired-provider');
  const providerToken = readyStatus.downloadUrl.split('/').at(-1);

  await assert.rejects(
    () => service.downloadByToken(providerToken),
    (error) => error.statusCode === 410 && error.errorCode === 'download_token_expired',
  );
});

test('cleanup skips missing export_jobs table during startup compatibility window', async () => {
  const service = createLicenseControlExportService({
    getPrismaClient: async () => ({
      exportJob: {
        async findMany() {
          const error = new Error('The table `public.export_jobs` does not exist');
          error.code = 'P2021';
          error.meta = { table: 'public.export_jobs' };
          throw error;
        },
      },
    }),
    schedule: () => {},
  });

  const result = await service.cleanupExpiredExports(new Date('2026-06-04T00:00:00.000Z'));

  assert.deepEqual(result, { expiredCount: 0, skipped: 'export_jobs_missing' });
});

test('download uses hashed token lookup and rejects path traversal basenames', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'shelfio-export-test-'));
  config.exportStorageDir = tempDir;
  const prisma = createPrismaMock();
  const service = createLicenseControlExportService({
    getPrismaClient: async () => prisma,
    schedule: () => {},
  });

  const rawToken = 'raw-download-token';
  const safeFile = 'tenant-export-test.xlsx';
  await writeFile(path.join(tempDir, safeFile), 'xlsx-bytes');
  prisma.rows.exportJobs.push({
    id: 'job-ready',
    tenantId: 'tenant-local-1',
    externalLicenseId: 'license-ext-1',
    status: EXPORT_STATUS.READY,
    fileName: 'shelfio-magaza-verileri-2026-06-03.xlsx',
    fileBasename: safeFile,
    downloadTokenHash: '04052db7c7038d1aad66879051b829a4d0aa068565ec4179ebe69aa4735fed88',
    downloadExpiresAt: new Date(Date.now() + 60_000),
    downloadCount: 0,
  });

  const downloaded = await service.downloadByToken(rawToken);

  assert.equal(downloaded.buffer.toString(), 'xlsx-bytes');
  assert.equal(prisma.rows.exportJobs[0].downloadCount, 1);
  assert.notEqual(prisma.rows.exportJobs[0].downloadTokenHash, rawToken);

  prisma.rows.exportJobs[0].downloadCount = 0;
  prisma.rows.exportJobs[0].fileBasename = '../escape.xlsx';
  await assert.rejects(
    () => service.downloadByToken(rawToken),
    (error) => error.statusCode === 400 && error.errorCode === 'export_file_path_invalid',
  );

  await rm(tempDir, { recursive: true, force: true });
});
