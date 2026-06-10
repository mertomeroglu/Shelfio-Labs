import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');

test('POS print actions print PDFs and historical actions pass the selected record directly', () => {
  const service = fs.readFileSync(path.join(root, 'frontend/src/services/posService.js'), 'utf8');
  const page = fs.readFileSync(path.join(root, 'frontend/src/pages/pos/POS.jsx'), 'utf8');

  assert.match(service, /createPdf\(docDefinition\)\.print\(\)/);
  assert.doesNotMatch(service, /createPdf\(docDefinition\)\.download\(/);
  assert.match(page, /printReceipt\(historyDetail\)/);
  assert.match(page, /printEInvoice\(historyDetail\)/);
  assert.doesNotMatch(page, /setReceiptData\(historyDetail\);\s*printReceipt\(\)/);
});

test('purchase suggestion handoff URLs include a query delimiter and created order status is validated', () => {
  const page = fs.readFileSync(path.join(root, 'frontend/src/pages/purchase-suggestions/PurchaseSuggestions.jsx'), 'utf8');

  assert.match(page, /`\/siparis-olustur\?\$\{params\.toString\(\)\}`/);
  assert.doesNotMatch(page, /`\/siparis-olustur\$\{params\.toString\(\)\}`/);
  assert.match(page, /submitted_for_approval/);
  assert.match(page, /kimlik, sipariş numarası veya durum bilgisi eksik/);
});

test('customer QR confirmation applies the backend cart and stores the persistent history row', () => {
  const page = fs.readFileSync(path.join(root, 'frontend/src/pages/customer-portal/CustomerPortal.jsx'), 'utf8');
  const service = fs.readFileSync(path.join(root, 'backend/src/services/mobileOrderService.js'), 'utf8');

  assert.match(page, /confirmedOrder\.customerOrder/);
  assert.match(page, /confirmedOrder\.activeCart/);
  assert.match(page, /setPendingMobileOrderId\(''\)/);
  assert.match(service, /customerOrder\.upsert/);
  assert.match(service, /cartCleanupCompleted: true/);
});
