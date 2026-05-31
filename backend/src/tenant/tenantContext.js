import { AsyncLocalStorage } from 'node:async_hooks';

export const MAIN_TENANT_ID = 'tenant_main_shelfio';
export const MAIN_STORE_ID = 'store-main';

const tenantStorage = new AsyncLocalStorage();

export const runWithTenantContext = (context, callback) => tenantStorage.run(context || {}, callback);

export const getTenantContext = () => tenantStorage.getStore() || {};

export const getActiveTenantId = () => getTenantContext().tenantId || MAIN_TENANT_ID;

export const getActiveStoreId = () => getTenantContext().storeId || MAIN_STORE_ID;

export const isTenantScopedRequest = () => Boolean(getTenantContext().tenantId);
