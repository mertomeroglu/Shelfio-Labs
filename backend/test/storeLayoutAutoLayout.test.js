import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');
const serviceFile = fs.readFileSync(
  path.join(root, 'backend/src/services/storeLayoutService.js'),
  'utf8'
);

test('storeLayoutService.js defines readable physical module spacing rules', () => {
  assert.match(serviceFile, /SECTION_BLOCK_WIDTH:\s*250/);
  assert.match(serviceFile, /SECTION_GAP_X:\s*132/);
  assert.match(serviceFile, /SECTION_GAP_Y:\s*138/);
  assert.match(serviceFile, /SHELF_STACK_WIDTH:\s*76/);
  assert.match(serviceFile, /WAREHOUSE_ZONE_GAP:\s*190/);
});

test('storeLayoutService.js collapses shelf and warehouse levels into metadata stacks', () => {
  assert.match(serviceFile, /const shelfGroups = new Map\(\)/);
  assert.match(serviceFile, /levelCount:\s*levels\.length/);
  assert.match(serviceFile, /collapsedStack:\s*true/);
  assert.match(serviceFile, /const warehouseGroups = new Map\(\)/);
});

test('storeLayoutService.js generates complete section and warehouse capacity before binding data', () => {
  assert.match(serviceFile, /SHELVES_PER_SIDE:\s*10/);
  assert.match(serviceFile, /LEVELS_PER_SHELF:\s*5/);
  assert.match(serviceFile, /Array\.from\(\{\s*length:\s*SECTION_CAPACITY\.LEVELS_PER_SHELF\s*\}/);
  assert.match(serviceFile, /SHELVES_PER_SIDE:\s*15/);
  assert.match(serviceFile, /LEVELS_PER_SHELF:\s*10/);
  assert.match(serviceFile, /Array\.from\(\{\s*length:\s*WAREHOUSE_CAPACITY\.LEVELS_PER_SHELF\s*\}/);
});

test('storeLayoutService.js separates warehouse and checkout zones', () => {
  assert.match(
    serviceFile,
    /const warehouseStartX\s*=\s*FALLBACK_LAYOUT\.START_X[\s\S]*FALLBACK_LAYOUT\.WAREHOUSE_ZONE_GAP/
  );
  assert.match(
    serviceFile,
    /const bottomZoneStartY\s*=\s*reyonBottom\s*\+\s*FALLBACK_LAYOUT\.CASHIER_ZONE_GAP/
  );
});

test('storeLayoutService.js returns a generated boundary and preserves render ordering', () => {
  assert.match(serviceFile, /const storeBoundary\s*=/);
  assert.match(serviceFile, /const warehouseBoundary\s*=/);
  assert.match(serviceFile, /const boundaries\s*=\s*\[storeBoundary,\s*warehouseBoundary\]/);
  assert.match(serviceFile, /const RENDER_ORDER\s*=\s*\{/);
  assert.match(
    serviceFile,
    /items\.sort\(\(a,\s*b\)\s*=>\s*getSortOrder\(a\.objectType\)\s*-\s*getSortOrder\(b\.objectType\)\)/
  );
});
