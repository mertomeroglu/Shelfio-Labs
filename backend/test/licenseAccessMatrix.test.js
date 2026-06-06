import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertLicensedModule, assertScreenAccess } from '../src/middlewares/authMiddleware.js';
import {
  extractSsoProvisioningContext,
  normalizePlanModules,
  PLAN_PAGES,
} from '../src/services/ssoProvisioningService.js';

const request = (originalUrl, method = 'GET') => ({ originalUrl, method });

test('dashboard stays available without reports while full reports remain plan-gated', () => {
  assert.doesNotThrow(() => assertLicensedModule(request('/api/reports/dashboard'), ['products']));
  assert.doesNotThrow(() => assertScreenAccess(request('/api/reports/dashboard'), PLAN_PAGES.demo));
  assert.throws(
    () => assertScreenAccess(request('/api/reports/day-end'), PLAN_PAGES.demo),
    (error) => error.errorCode === 'screen_access_denied',
  );
});

test('pricing analysis and order creation use their own licensed screens', () => {
  assert.throws(
    () => assertScreenAccess(request('/api/reports/pricing-analysis'), PLAN_PAGES.pro),
    (error) => error.details?.requiredScreen === 'Fiyat & Talep Analizi',
  );
  assert.doesNotThrow(() => assertScreenAccess(
    request('/api/procurement/orders', 'POST'),
    ['Sipariş Oluştur'],
  ));
  assert.throws(
    () => assertScreenAccess(request('/api/procurement/orders', 'POST'), ['Sipariş Takibi']),
    (error) => error.details?.requiredScreen === 'Sipariş Oluştur',
  );
});

test('customer management no longer requires the customer mobile screen', () => {
  assert.doesNotThrow(() => assertScreenAccess(request('/api/customers'), ['Müşteri Yönetimi']));
  assert.throws(
    () => assertScreenAccess(request('/api/customer-auth/catalog'), ['Müşteri Yönetimi']),
    (error) => error.details?.requiredScreen === 'Müşteri Mobil',
  );
});

test('plan normalization derives technical modules and stores normalized SSO summary', () => {
  const modules = normalizePlanModules('pro', [], PLAN_PAGES.pro);
  assert.equal(modules.includes('reports'), true);
  assert.equal(modules.includes('purchase_orders'), true);
  assert.equal(modules.includes('stock_batches'), true);
  assert.equal(modules.includes('stock_movements'), true);

  const context = extractSsoProvisioningContext({
    user: { email: 'owner@example.com' },
    license: { id: 'license-pro-1', status: 'active', plan: 'pro' },
  });
  assert.deepEqual(context.licenseSummary.screenAccess, PLAN_PAGES.pro);
  assert.deepEqual(context.licenseSummary.enabledModules, context.enabledModules);
});

test('frontend session persistence and direct route guard retain plan access context', async () => {
  const authService = await readFile(new URL('../../frontend/src/services/authService.js', import.meta.url), 'utf8');
  const api = await readFile(new URL('../../frontend/src/services/api.js', import.meta.url), 'utf8');
  const layout = await readFile(new URL('../../frontend/src/components/Layout.jsx', import.meta.url), 'utf8');

  assert.match(authService, /screenAccess: data\.screenAccess \|\| licenseSummary\?\.screenAccess/);
  assert.match(api, /screenAccess: data\.screenAccess \|\| licenseSummary\?\.screenAccess/);
  assert.match(layout, /isBlockedByPlan \?/);
  assert.match(layout, /Bu ekran mevcut lisans planınızda aktif değil\./);
});
