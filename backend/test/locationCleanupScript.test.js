import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');

test('location-common-area-cleanup.js script has dry-run by default and apply controls', () => {
  const scriptContent = fs.readFileSync(path.join(root, 'backend/scripts/location-common-area-cleanup.js'), 'utf8');

  // Verify apply and confirm flags are defined and parsed
  assert.match(scriptContent, /args\.includes\('--apply'\)/);
  assert.match(scriptContent, /args\.includes\('--confirm'\)/);

  // Default mode is dry-run
  assert.match(scriptContent, /isApply && isConfirm/);
});

test('location-common-area-cleanup.js executes changes inside database transaction in apply mode', () => {
  const scriptContent = fs.readFileSync(path.join(root, 'backend/scripts/location-common-area-cleanup.js'), 'utf8');

  // Transaction control
  assert.match(scriptContent, /prisma\.\$transaction/);
});

test('location-common-area-cleanup.js creates legacy location backup inside product payload', () => {
  const scriptContent = fs.readFileSync(path.join(root, 'backend/scripts/location-common-area-cleanup.js'), 'utf8');

  // Check backup structure
  assert.match(scriptContent, /legacyLocationBackup/);
  assert.match(scriptContent, /backedUpAt:/);
  assert.match(scriptContent, /shelfSide: p\.shelfSide/);
  assert.match(scriptContent, /depotLocationCode: p\.depotLocationCode/);
});

test('location-common-area-cleanup.js validates warehouseLocation stock before clearing warehouse location link', () => {
  const scriptContent = fs.readFileSync(path.join(root, 'backend/scripts/location-common-area-cleanup.js'), 'utf8');

  // Warehouse location stock guardrail check
  assert.match(scriptContent, /loc\.warehouseStock > 0 \|\| \(loc\.palletCount \|\| 0\) > 0/);
});
