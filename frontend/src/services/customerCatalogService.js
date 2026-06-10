import { customerPortalAuthService, customerPortalRequest } from './customerPortalAuthService.js';
import { normalizeProductRecord } from './productService.js';
import { buildQueryString } from './api.js';

const pendingCatalogRequests = new Map();
let customerCategoriesCache = null;

const buildCatalogRequestKey = (params = {}) => {
  const normalizedParams = Object.entries(params || {})
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => [key, String(value)]);
  const customer = customerPortalAuthService.getStoredUser();
  const sessionKey = customerPortalAuthService.isLoggedIn()
    ? `customer:${customer?.id || customer?.customerId || 'authenticated'}`
    : 'guest';
  return `${sessionKey}:${JSON.stringify(normalizedParams)}`;
};

const normalizeCatalogPayload = (payload = {}) => {
  const products = Array.isArray(payload?.products) ? payload.products.map(normalizeProductRecord) : [];
  const productById = new Map(products.map((product) => [String(product.id || product.productId || ''), product]));
  return {
    ...payload,
    products,
    categories: Array.isArray(payload?.categories) ? payload.categories : [],
    campaigns: Array.isArray(payload?.campaigns)
      ? payload.campaigns.map((campaign) => ({
        ...campaign,
        products: Array.isArray(campaign?.products)
          ? campaign.products.map((product) => productById.get(String(product?.id || product?.productId || '')) || normalizeProductRecord(product))
          : [],
      }))
      : [],
    storefront: payload?.storefront && typeof payload.storefront === 'object' ? payload.storefront : {},
    pagination: payload?.pagination || null,
  };
};

export const customerCatalogService = {
  async getCatalog(params = {}) {
    const requestKey = buildCatalogRequestKey(params);
    if (pendingCatalogRequests.has(requestKey)) {
      return pendingCatalogRequests.get(requestKey);
    }

    const pending = customerPortalRequest(`/customer-auth/catalog${buildQueryString(params)}`)
      .then(normalizeCatalogPayload)
      .finally(() => {
        pendingCatalogRequests.delete(requestKey);
      });

    pendingCatalogRequests.set(requestKey, pending);
    return pending;
  },

  async getCategories({ force = false } = {}) {
    if (!force && Array.isArray(customerCategoriesCache) && customerCategoriesCache.length > 0) {
      return customerCategoriesCache;
    }

    const catalog = await this.getCatalog({ mode: 'categories' });
    const categories = Array.isArray(catalog?.categories) ? catalog.categories : [];
    if (categories.length > 0) customerCategoriesCache = categories;
    return categories;
  },

  async getProductById(id) {
    const payload = await customerPortalRequest(`/customer-auth/catalog/${encodeURIComponent(id)}`);
    return normalizeProductRecord(payload || {});
  },

  async getProductByBarcode(barcode) {
    const payload = await customerPortalRequest(`/customer-auth/catalog/barcode/${encodeURIComponent(barcode)}`);
    return normalizeProductRecord(payload || {});
  },

  async getProductStockForecast(id) {
    return customerPortalRequest(`/customer-auth/catalog/${encodeURIComponent(id)}/stock-forecast`);
  },

  async getCartRoutePlan(items) {
    return customerPortalRequest('/customer-auth/cart/route-plan', {
      method: 'POST',
      body: JSON.stringify({ items }),
    });
  },
};
