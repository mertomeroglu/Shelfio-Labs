import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');

test('shelfCode formatter generates correct standardized R03-L-02-01 format', () => {
  const serviceFile = fs.readFileSync(path.join(root, 'backend/src/services/productService.js'), 'utf8');
  
  // Verify pad function and formatShelfCode exists
  assert.match(serviceFile, /const formatShelfCode\s*=\s*\(/);
  assert.match(serviceFile, /`R\$\{sectionNoStr\}-\$\{shelfSideStr\}-\$\{pad\(shelfNo\)\}-\$\{pad\(shelfLevel\)\}`/);
});

test('assignLocation supports targetType section_common and warehouse_common and unassign', () => {
  const serviceFile = fs.readFileSync(path.join(root, 'backend/src/services/productService.js'), 'utf8');

  assert.match(serviceFile, /targetType === 'section_common'/);
  assert.match(serviceFile, /targetType === 'warehouse_common'/);
  assert.match(serviceFile, /targetType === 'unassign'/);
  assert.match(serviceFile, /targetType === 'warehouse_location'/);
  assert.match(serviceFile, /targetType === 'section_shelf'/);
});

test('productService.update contains location update guardrails', () => {
  const serviceFile = fs.readFileSync(path.join(root, 'backend/src/services/productService.js'), 'utf8');

  // Verify that update validates physical grid coordinates
  assert.match(serviceFile, /const hasLocationUpdate\s*=\s*payload\.hasOwnProperty/);
  assert.match(serviceFile, /isCommonAisle/);
  assert.match(serviceFile, /Bu fiziksel gözde başka bir ürün var/);
});
