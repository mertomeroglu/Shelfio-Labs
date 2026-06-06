import crypto from 'node:crypto';
import { mkdir, readFile, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config/config.js';
import { getPrisma } from '../providers/postgresProvider.js';
import { AppError } from '../utils/appError.js';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PAGE_SIZE = 1000;
const FORBIDDEN_LICENSE_STATUSES = new Set(['revoked', 'suspended', 'fraud', 'cancelled', 'canceled']);
const SENSITIVE_JSON_KEY_PATTERN = /(password|token|secret|pin|key|hash|auth|session)/i;
const SAFE_FILE_NAME_PATTERN = /^[a-zA-Z0-9._-]+$/;
const isMissingExportJobTableError = (error) => (
  String(error?.code || '') === 'P2021'
  && /export_jobs|ExportJob/i.test(String(error?.message || error?.meta?.table || ''))
);

export const EXPORT_STATUS = {
  QUEUED: 'queued',
  RUNNING: 'running',
  READY: 'ready',
  FAILED: 'failed',
  EXPIRED: 'expired',
};

export const redactSensitiveJson = (value) => {
  if (Array.isArray(value)) return value.map((item) => redactSensitiveJson(item));
  if (!value || typeof value !== 'object') return value;

  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key,
    SENSITIVE_JSON_KEY_PATTERN.test(String(key)) ? '[REDACTED]' : redactSensitiveJson(entry),
  ]));
};

const cleanText = (value, max = 250) => String(value || '').trim().slice(0, max);
const normalizeEmail = (value) => cleanText(value, 320).toLowerCase() || null;
const hashOpaqueValue = (value) => crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
const getProviderTokenSecret = () => (
  config.shelfioLabsUsageSecret
  || config.getshelfioControlSecret
  || config.jwtSecret
  || 'shelfio-export-provider-token'
);
const signProviderToken = (payload) => crypto
  .createHmac('sha256', getProviderTokenSecret())
  .update(payload)
  .digest('base64url');
const createProviderDownloadToken = (job) => {
  const payload = Buffer.from(JSON.stringify({
    jobId: cleanText(job?.id, 120),
  })).toString('base64url');
  return `v1.${payload}.${signProviderToken(payload)}`;
};
const toIso = (value) => {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : String(value);
};
const toCell = (value) => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object' && typeof value.toNumber === 'function') return value.toNumber();
  if (typeof value === 'object') return JSON.stringify(redactSensitiveJson(value));
  return value;
};
const jsonCell = (value) => (value === null || value === undefined ? '' : JSON.stringify(redactSensitiveJson(value)));
const lower = (value) => String(value || '').trim().toLowerCase();
const addDays = (hours) => new Date(Date.now() + Math.max(1, Number(hours || 24)) * 60 * 60 * 1000);
const buildPublicDownloadUrl = (token) => `${String(config.publicApiBaseUrl || '').replace(/\/+$/, '')}/api/license-control/exports/download/${token}`;

const safeExportBasename = (jobId) => `tenant-export-${cleanText(jobId, 80).replace(/[^a-zA-Z0-9_-]/g, '')}.xlsx`;
const publicFileName = () => `shelfio-magaza-verileri-${new Date().toISOString().slice(0, 10)}.xlsx`;

const assertSafeBasename = (fileBasename) => {
  const basename = path.basename(String(fileBasename || ''));
  if (!basename || basename !== fileBasename || !SAFE_FILE_NAME_PATTERN.test(basename)) {
    throw new AppError(400, 'Export dosya yolu gecersiz.', { errorCode: 'export_file_path_invalid' });
  }
  return basename;
};

const resolveExportPath = (fileBasename) => {
  const safeBasename = assertSafeBasename(fileBasename);
  const storageDir = path.resolve(config.exportStorageDir);
  const resolvedPath = path.resolve(storageDir, safeBasename);
  if (!resolvedPath.startsWith(`${storageDir}${path.sep}`)) {
    throw new AppError(400, 'Export dosya yolu gecersiz.', { errorCode: 'export_file_path_invalid' });
  }
  return resolvedPath;
};

const appendSheet = (XLSX, workbook, name, columns, rows) => {
  const safeColumns = columns.filter((column) => column.key && column.header);
  const headers = safeColumns.map((column) => column.header);
  const tableRows = rows.map((row) => safeColumns.map((column) => toCell(row[column.key])));
  if (!tableRows.length && headers.length) tableRows.push(headers.map(() => ''));

  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...tableRows]);
  worksheet['!cols'] = headers.map((header, index) => ({
    wch: Math.min(48, Math.max(12, String(header || '').length + 2, ...tableRows.map((row) => String(row[index] ?? '').length + 2))),
  }));
  if (headers.length > 0) {
    worksheet['!autofilter'] = {
      ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: tableRows.length, c: headers.length - 1 } }),
    };
  }
  XLSX.utils.book_append_sheet(workbook, worksheet, name.slice(0, 31));
};

const fetchTenantRows = async (delegate, tenantId, { where = {}, select = null, orderBy = { id: 'asc' } } = {}) => {
  const rows = [];
  let cursor = null;
  for (;;) {
    const page = await delegate.findMany({
      where: { ...where, tenantId },
      ...(select ? { select } : {}),
      orderBy,
      take: PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    cursor = page[page.length - 1].id;
  }
  return rows;
};

const findLicenseForExport = async (prisma, externalLicenseId, externalTenantId) => {
  const licenseId = cleanText(externalLicenseId, 180);
  if (!licenseId) {
    throw new AppError(400, 'External license kimligi zorunludur.', { errorCode: 'external_license_id_required' });
  }

  const license = await prisma.license.findUnique({
    where: { externalLicenseId: licenseId },
    include: { tenant: true, plan: true },
  });
  if (!license?.tenant) {
    throw new AppError(404, 'Lisans mapping bulunamadi.', { errorCode: 'license_mapping_not_found' });
  }

  const status = lower(license.externalStatus || license.status);
  if (FORBIDDEN_LICENSE_STATUSES.has(status)) {
    throw new AppError(403, 'Bu lisans icin veri export izni yok.', { errorCode: 'license_export_forbidden' });
  }

  const crossCheck = cleanText(externalTenantId, 180);
  if (crossCheck) {
    const matchesLicense = license.externalTenantId === crossCheck;
    const matchesTenant = license.tenant.externalTenantId === crossCheck;
    if (!matchesLicense && !matchesTenant) {
      throw new AppError(403, 'External tenant bilgisi lisans ile eslesmiyor.', { errorCode: 'external_tenant_mismatch' });
    }
  }

  return license;
};

const maybePostCallback = async (job, payload) => {
  const url = cleanText(job.callbackUrl, 1000);
  if (!url) return;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }
  if (!['https:', 'http:'].includes(parsed.protocol)) return;

  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.error('[export-callback] failed', {
      jobId: job.id,
      errorCode: error?.code || '',
      message: error?.message || '',
    });
  }
};

const mapStoreRows = (rows) => rows.map((row) => ({
  storeRef: row.id,
  name: row.name,
  code: row.code,
  status: row.status,
  createdAt: toIso(row.createdAt),
  updatedAt: toIso(row.updatedAt),
  payload: jsonCell(row.payload),
}));

const mapUserRows = (rows) => rows.map((row) => ({
  userRef: row.id,
  storeRef: row.storeId,
  username: row.username,
  name: row.name,
  email: row.email,
  role: row.role,
  department: row.department,
  assignedDeskCode: row.assignedDeskCode,
  isActive: row.isActive,
  lastLoginAt: toIso(row.lastLoginAt),
  permissions: jsonCell(row.permissions),
  payload: jsonCell(row.payload),
  createdAt: toIso(row.createdAt),
  updatedAt: toIso(row.updatedAt),
}));

const mapProductRows = (rows) => rows.map((row) => ({
  productRef: row.id,
  sku: row.sku,
  barcode: row.barcode,
  name: row.name,
  brand: row.brand,
  categoryRef: row.categoryId,
  supplierRef: row.supplierId,
  sectionRef: row.sectionId,
  shelfCode: row.shelfCode,
  unit: row.unit,
  purchasePrice: row.purchasePrice,
  salePrice: row.salePrice,
  criticalStock: row.criticalStock,
  maxStock: row.maxStock,
  isListed: row.isListed,
  isActive: row.isActive,
  catalogVisibility: row.catalogVisibility,
  payload: jsonCell(row.payload),
  createdAt: toIso(row.createdAt),
  updatedAt: toIso(row.updatedAt),
}));

const mapSalesRows = (rows) => rows.map((row) => ({
  saleRef: row.id,
  referenceNo: row.referenceNo,
  type: row.type,
  deskCode: row.deskCode,
  cashierRef: row.cashierId,
  cashierName: row.cashierName,
  subtotal: row.subtotal,
  discount: row.discount,
  totalAmount: row.totalAmount,
  paymentMethod: row.paymentMethod,
  originalSaleRef: row.originalSaleRef,
  status: row.status,
  customer: jsonCell(row.customer),
  payload: jsonCell(row.payload),
  createdAt: toIso(row.createdAt),
  updatedAt: toIso(row.updatedAt),
}));

const buildPaymentRows = (sales) => sales.flatMap((sale) => {
  const payments = Array.isArray(sale.payments) ? sale.payments : [];
  if (!payments.length && sale.paymentMethod) {
    return [{
      saleRef: sale.id,
      referenceNo: sale.referenceNo,
      method: sale.paymentMethod,
      amount: sale.totalAmount,
      currency: '',
      status: sale.status,
      rawIndex: 0,
    }];
  }
  return payments.map((payment, index) => ({
    saleRef: sale.id,
    referenceNo: sale.referenceNo,
    method: payment?.method || payment?.paymentMethod || payment?.type || '',
    amount: payment?.amount || payment?.total || '',
    currency: payment?.currency || '',
    status: payment?.status || sale.status || '',
    rawIndex: index,
    payload: jsonCell(payment),
  }));
});

const buildReturnRows = (sales) => sales
  .filter((sale) => ['return', 'refund', 'cancel', 'cancelled', 'canceled', 'void'].some((item) => lower(`${sale.type} ${sale.status}`).includes(item)))
  .map((sale) => ({
    saleRef: sale.id,
    referenceNo: sale.referenceNo,
    originalSaleRef: sale.originalSaleRef,
    deskCode: sale.deskCode,
    cashierName: sale.cashierName,
    totalAmount: sale.totalAmount,
    status: sale.status,
    customer: jsonCell(sale.customer),
    payload: jsonCell(sale.payload),
    createdAt: toIso(sale.createdAt),
  }));

const buildBarcodeRows = (products, supplierProducts) => {
  const rows = [];
  products.forEach((product) => {
    if (product.barcode) {
      rows.push({ barcode: product.barcode, productRef: product.id, sku: product.sku, productName: product.name, source: 'products' });
    }
  });
  supplierProducts.forEach((item) => {
    if (item.barcode) {
      rows.push({ barcode: item.barcode, productRef: item.productId, supplierRef: item.supplierId, sku: item.supplierSku, productName: item.supplierProductName, source: 'supplier_products' });
    }
  });
  return rows;
};

const buildWorkbook = async (prisma, { tenant, license, includeAuditLogs }) => {
  const xlsxModule = await import('xlsx');
  const XLSX = xlsxModule.default || xlsxModule;
  const workbook = XLSX.utils.book_new();
  const tenantId = tenant.id;

  const [
    stores,
    users,
    products,
    categories,
    sections,
    supplierProducts,
    stocks,
    stockBatches,
    stockMovements,
    suppliers,
    purchaseOrders,
    purchaseOrderItems,
    sales,
    saleItems,
    eslDevices,
    eslHistory,
    settings,
  ] = await Promise.all([
    prisma.store.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } }),
    fetchTenantRows(prisma.user, tenantId),
    fetchTenantRows(prisma.product, tenantId),
    fetchTenantRows(prisma.category, tenantId),
    fetchTenantRows(prisma.section, tenantId),
    fetchTenantRows(prisma.supplierProduct, tenantId),
    fetchTenantRows(prisma.stock, tenantId),
    fetchTenantRows(prisma.stockBatch, tenantId),
    fetchTenantRows(prisma.stockMovement, tenantId, { orderBy: { createdAt: 'asc' } }),
    fetchTenantRows(prisma.supplier, tenantId),
    fetchTenantRows(prisma.purchaseOrder, tenantId, { orderBy: { createdAt: 'asc' } }),
    fetchTenantRows(prisma.purchaseOrderItem, tenantId),
    fetchTenantRows(prisma.sale, tenantId, { orderBy: { createdAt: 'asc' } }),
    fetchTenantRows(prisma.saleItem, tenantId),
    fetchTenantRows(prisma.eslDevice, tenantId),
    fetchTenantRows(prisma.eslHistory, tenantId, { orderBy: { createdAt: 'asc' } }),
    prisma.setting.findMany({ where: { tenantId }, orderBy: { id: 'asc' } }),
  ]);

  const settingsRow = settings[0] || {};
  appendSheet(XLSX, workbook, 'README', [
    { key: 'field', header: 'Field' },
    { key: 'value', header: 'Value' },
  ], [
    { field: 'exportId', value: '' },
    { field: 'externalLicenseId', value: license.externalLicenseId },
    { field: 'externalTenantId', value: tenant.externalTenantId || license.externalTenantId || '' },
    { field: 'tenantName', value: tenant.name },
    { field: 'generatedAt', value: new Date().toISOString() },
    { field: 'scope', value: 'tenant' },
    { field: 'timezone', value: settingsRow.timezone || '' },
    { field: 'currency', value: settingsRow.currency || '' },
    { field: 'excludedSensitiveFields', value: 'passwordHash, registerPin, tokenHash, licenseKeyHash, exchangeCodeHash, reset/setup/session/download tokens, secrets, PINs, auth/session tokens' },
  ]);

  appendSheet(XLSX, workbook, 'Stores', [
    { key: 'storeRef', header: 'Store Ref' }, { key: 'name', header: 'Name' }, { key: 'code', header: 'Code' },
    { key: 'status', header: 'Status' }, { key: 'createdAt', header: 'Created At' }, { key: 'updatedAt', header: 'Updated At' },
    { key: 'payload', header: 'Payload' },
  ], mapStoreRows(stores));
  appendSheet(XLSX, workbook, 'Users', [
    { key: 'userRef', header: 'User Ref' }, { key: 'storeRef', header: 'Store Ref' }, { key: 'username', header: 'Username' },
    { key: 'name', header: 'Name' }, { key: 'email', header: 'Email' }, { key: 'role', header: 'Role' },
    { key: 'department', header: 'Department' }, { key: 'assignedDeskCode', header: 'Desk Code' }, { key: 'isActive', header: 'Active' },
    { key: 'lastLoginAt', header: 'Last Login At' }, { key: 'permissions', header: 'Permissions' }, { key: 'payload', header: 'Payload' },
    { key: 'createdAt', header: 'Created At' }, { key: 'updatedAt', header: 'Updated At' },
  ], mapUserRows(users));
  appendSheet(XLSX, workbook, 'Products', [
    { key: 'productRef', header: 'Product Ref' }, { key: 'sku', header: 'SKU' }, { key: 'barcode', header: 'Barcode' },
    { key: 'name', header: 'Name' }, { key: 'brand', header: 'Brand' }, { key: 'categoryRef', header: 'Category Ref' },
    { key: 'supplierRef', header: 'Supplier Ref' }, { key: 'sectionRef', header: 'Section Ref' }, { key: 'shelfCode', header: 'Shelf Code' },
    { key: 'unit', header: 'Unit' }, { key: 'purchasePrice', header: 'Purchase Price' }, { key: 'salePrice', header: 'Sale Price' },
    { key: 'criticalStock', header: 'Critical Stock' }, { key: 'maxStock', header: 'Max Stock' }, { key: 'isListed', header: 'Listed' },
    { key: 'isActive', header: 'Active' }, { key: 'catalogVisibility', header: 'Catalog Visibility' }, { key: 'payload', header: 'Payload' },
    { key: 'createdAt', header: 'Created At' }, { key: 'updatedAt', header: 'Updated At' },
  ], mapProductRows(products));
  appendSheet(XLSX, workbook, 'Categories', [
    { key: 'categoryRef', header: 'Category Ref' }, { key: 'code', header: 'Code' }, { key: 'name', header: 'Name' },
    { key: 'description', header: 'Description' }, { key: 'mainSectionNo', header: 'Main Section No' }, { key: 'mainStorageType', header: 'Storage Type' },
    { key: 'isActive', header: 'Active' }, { key: 'payload', header: 'Payload' },
  ], categories.map((row) => ({ categoryRef: row.id, ...row, payload: jsonCell(row.payload) })));
  appendSheet(XLSX, workbook, 'Barcodes', [
    { key: 'barcode', header: 'Barcode' }, { key: 'productRef', header: 'Product Ref' }, { key: 'supplierRef', header: 'Supplier Ref' },
    { key: 'sku', header: 'SKU' }, { key: 'productName', header: 'Product Name' }, { key: 'source', header: 'Source' },
  ], buildBarcodeRows(products, supplierProducts));
  appendSheet(XLSX, workbook, 'Prices', [
    { key: 'productRef', header: 'Product Ref' }, { key: 'sku', header: 'SKU' }, { key: 'name', header: 'Product Name' },
    { key: 'purchasePrice', header: 'Purchase Price' }, { key: 'salePrice', header: 'Sale Price' },
    { key: 'priceUpdatedAt', header: 'Price Updated At' }, { key: 'lastPriceChangeAt', header: 'Last Price Change At' },
    { key: 'lastPriceChangeSource', header: 'Last Price Change Source' },
  ], products.map((row) => ({ productRef: row.id, ...row, priceUpdatedAt: toIso(row.priceUpdatedAt), lastPriceChangeAt: toIso(row.lastPriceChangeAt) })));
  appendSheet(XLSX, workbook, 'Stock', [
    { key: 'stockRef', header: 'Stock Ref' }, { key: 'productRef', header: 'Product Ref' }, { key: 'warehouseQuantity', header: 'Warehouse Quantity' },
    { key: 'shelfQuantity', header: 'Shelf Quantity' }, { key: 'quantity', header: 'Quantity' }, { key: 'onHand', header: 'On Hand' },
    { key: 'available', header: 'Available' }, { key: 'reserved', header: 'Reserved' }, { key: 'batchCount', header: 'Batch Count' },
    { key: 'nearestExpiry', header: 'Nearest Expiry' }, { key: 'payload', header: 'Payload' }, { key: 'updatedAt', header: 'Updated At' },
  ], stocks.map((row) => ({ stockRef: row.id, productRef: row.productId, ...row, payload: jsonCell(row.payload), updatedAt: toIso(row.updatedAt) })));
  appendSheet(XLSX, workbook, 'StockBatches', [
    { key: 'batchRef', header: 'Batch Ref' }, { key: 'stockRef', header: 'Stock Ref' }, { key: 'productRef', header: 'Product Ref' },
    { key: 'batchNo', header: 'Batch No' }, { key: 'skt', header: 'SKT' }, { key: 'warehouseQuantity', header: 'Warehouse Quantity' },
    { key: 'shelfQuantity', header: 'Shelf Quantity' }, { key: 'totalQuantity', header: 'Total Quantity' }, { key: 'status', header: 'Status' },
    { key: 'payload', header: 'Payload' },
  ], stockBatches.map((row) => ({ batchRef: row.id, stockRef: row.stockId, productRef: row.productId, ...row, payload: jsonCell(row.payload) })));
  appendSheet(XLSX, workbook, 'StockMovements', [
    { key: 'movementRef', header: 'Movement Ref' }, { key: 'productRef', header: 'Product Ref' }, { key: 'supplierRef', header: 'Supplier Ref' },
    { key: 'productName', header: 'Product Name' }, { key: 'sku', header: 'SKU' }, { key: 'type', header: 'Type' },
    { key: 'qty', header: 'Qty' }, { key: 'fromLocation', header: 'From Location' }, { key: 'toLocation', header: 'To Location' },
    { key: 'reasonCode', header: 'Reason Code' }, { key: 'reasonLabel', header: 'Reason Label' }, { key: 'referenceNo', header: 'Reference No' },
    { key: 'userRef', header: 'User Ref' }, { key: 'userName', header: 'User Name' }, { key: 'batchNo', header: 'Batch No' },
    { key: 'skt', header: 'SKT' }, { key: 'payload', header: 'Payload' }, { key: 'createdAt', header: 'Created At' },
  ], stockMovements.map((row) => ({ movementRef: row.id, productRef: row.productId, supplierRef: row.supplierId, userRef: row.userId, ...row, payload: jsonCell(row.payload), createdAt: toIso(row.createdAt) })));
  appendSheet(XLSX, workbook, 'Suppliers', [
    { key: 'supplierRef', header: 'Supplier Ref' }, { key: 'supplierCode', header: 'Supplier Code' }, { key: 'code', header: 'Code' },
    { key: 'name', header: 'Name' }, { key: 'type', header: 'Type' }, { key: 'website', header: 'Website' },
    { key: 'isActive', header: 'Active' }, { key: 'payload', header: 'Payload' },
  ], suppliers.map((row) => ({ supplierRef: row.id, ...row, payload: jsonCell(row.payload) })));
  appendSheet(XLSX, workbook, 'PurchaseOrders', [
    { key: 'orderRef', header: 'Order Ref' }, { key: 'orderNumber', header: 'Order Number' }, { key: 'supplierRef', header: 'Supplier Ref' },
    { key: 'status', header: 'Status' }, { key: 'currentStatus', header: 'Current Status' }, { key: 'currency', header: 'Currency' },
    { key: 'subtotalAmount', header: 'Subtotal' }, { key: 'taxAmount', header: 'Tax' }, { key: 'grandTotal', header: 'Grand Total' },
    { key: 'createdByRef', header: 'Created By Ref' }, { key: 'payload', header: 'Payload' }, { key: 'createdAt', header: 'Created At' },
  ], purchaseOrders.map((row) => ({ orderRef: row.id, supplierRef: row.supplierId, createdByRef: row.createdBy, ...row, payload: jsonCell(row.payload), createdAt: toIso(row.createdAt) })));
  appendSheet(XLSX, workbook, 'PurchaseOrderItems', [
    { key: 'itemRef', header: 'Item Ref' }, { key: 'orderRef', header: 'Order Ref' }, { key: 'productRef', header: 'Product Ref' },
    { key: 'quantity', header: 'Quantity' }, { key: 'unitPrice', header: 'Unit Price' }, { key: 'totalPrice', header: 'Total Price' },
    { key: 'unit', header: 'Unit' }, { key: 'taxRate', header: 'Tax Rate' }, { key: 'taxAmount', header: 'Tax Amount' },
    { key: 'payload', header: 'Payload' },
  ], purchaseOrderItems.map((row) => ({ itemRef: row.id, orderRef: row.orderId, productRef: row.productId, ...row, payload: jsonCell(row.payload) })));
  appendSheet(XLSX, workbook, 'Sales', [
    { key: 'saleRef', header: 'Sale Ref' }, { key: 'referenceNo', header: 'Reference No' }, { key: 'type', header: 'Type' },
    { key: 'deskCode', header: 'Desk Code' }, { key: 'cashierRef', header: 'Cashier Ref' }, { key: 'cashierName', header: 'Cashier Name' },
    { key: 'subtotal', header: 'Subtotal' }, { key: 'discount', header: 'Discount' }, { key: 'totalAmount', header: 'Total Amount' },
    { key: 'paymentMethod', header: 'Payment Method' }, { key: 'originalSaleRef', header: 'Original Sale Ref' }, { key: 'status', header: 'Status' },
    { key: 'customer', header: 'Customer' }, { key: 'payload', header: 'Payload' }, { key: 'createdAt', header: 'Created At' },
  ], mapSalesRows(sales));
  appendSheet(XLSX, workbook, 'SaleItems', [
    { key: 'itemRef', header: 'Item Ref' }, { key: 'saleRef', header: 'Sale Ref' }, { key: 'productRef', header: 'Product Ref' },
    { key: 'barcode', header: 'Barcode' }, { key: 'name', header: 'Name' }, { key: 'sku', header: 'SKU' },
    { key: 'quantity', header: 'Quantity' }, { key: 'vatRate', header: 'VAT Rate' }, { key: 'unitPrice', header: 'Unit Price' },
    { key: 'totalPrice', header: 'Total Price' }, { key: 'payload', header: 'Payload' },
  ], saleItems.map((row) => ({ itemRef: row.id, saleRef: row.saleId, productRef: row.productId, ...row, payload: jsonCell(row.payload) })));
  appendSheet(XLSX, workbook, 'Payments', [
    { key: 'saleRef', header: 'Sale Ref' }, { key: 'referenceNo', header: 'Reference No' }, { key: 'method', header: 'Method' },
    { key: 'amount', header: 'Amount' }, { key: 'currency', header: 'Currency' }, { key: 'status', header: 'Status' },
    { key: 'rawIndex', header: 'Raw Index' }, { key: 'payload', header: 'Payload' },
  ], buildPaymentRows(sales));
  appendSheet(XLSX, workbook, 'Returns', [
    { key: 'saleRef', header: 'Sale Ref' }, { key: 'referenceNo', header: 'Reference No' }, { key: 'originalSaleRef', header: 'Original Sale Ref' },
    { key: 'deskCode', header: 'Desk Code' }, { key: 'cashierName', header: 'Cashier Name' }, { key: 'totalAmount', header: 'Total Amount' },
    { key: 'status', header: 'Status' }, { key: 'customer', header: 'Customer' }, { key: 'payload', header: 'Payload' }, { key: 'createdAt', header: 'Created At' },
  ], buildReturnRows(sales));
  appendSheet(XLSX, workbook, 'ESL', [
    { key: 'deviceRef', header: 'Device Ref' }, { key: 'name', header: 'Name' }, { key: 'macAddress', header: 'MAC Address' },
    { key: 'model', header: 'Model' }, { key: 'firmwareVersion', header: 'Firmware Version' }, { key: 'batteryLevel', header: 'Battery Level' },
    { key: 'status', header: 'Status' }, { key: 'productRef', header: 'Product Ref' }, { key: 'location', header: 'Location' },
    { key: 'ipAddress', header: 'IP Address' }, { key: 'isDeleted', header: 'Deleted' }, { key: 'payload', header: 'Payload' }, { key: 'lastSyncAt', header: 'Last Sync At' },
  ], eslDevices.map((row) => ({ deviceRef: row.id, productRef: row.assignedProductId, ...row, payload: jsonCell(row.payload), lastSyncAt: toIso(row.lastSyncAt) })));
  appendSheet(XLSX, workbook, 'ESLHistory', [
    { key: 'historyRef', header: 'History Ref' }, { key: 'deviceRef', header: 'Device Ref' }, { key: 'deviceName', header: 'Device Name' },
    { key: 'productRef', header: 'Product Ref' }, { key: 'productName', header: 'Product Name' }, { key: 'productSku', header: 'Product SKU' },
    { key: 'productBarcode', header: 'Product Barcode' }, { key: 'salePrice', header: 'Sale Price' }, { key: 'template', header: 'Template' },
    { key: 'customFields', header: 'Custom Fields' }, { key: 'status', header: 'Status' }, { key: 'payload', header: 'Payload' }, { key: 'createdAt', header: 'Created At' },
  ], eslHistory.map((row) => ({ historyRef: row.id, deviceRef: row.deviceId, productRef: row.productId, ...row, customFields: jsonCell(row.customFields), payload: jsonCell(row.payload), createdAt: toIso(row.createdAt) })));
  appendSheet(XLSX, workbook, 'Settings', [
    { key: 'settingRef', header: 'Setting Ref' }, { key: 'storeRef', header: 'Store Ref' }, { key: 'systemName', header: 'System Name' },
    { key: 'companyName', header: 'Company Name' }, { key: 'currency', header: 'Currency' }, { key: 'timezone', header: 'Timezone' },
    { key: 'payload', header: 'Payload' }, { key: 'updatedAt', header: 'Updated At' },
  ], settings.map((row) => ({ settingRef: row.id, storeRef: row.storeId, ...row, payload: jsonCell(row.payload), updatedAt: toIso(row.updatedAt) })));

  if (includeAuditLogs) {
    const [auditLogs, accessAuditLogs, loginActivityLogs] = await Promise.all([
      fetchTenantRows(prisma.auditLog, tenantId, { orderBy: { createdAt: 'asc' } }),
      fetchTenantRows(prisma.accessAuditLog, tenantId, { orderBy: { createdAt: 'asc' } }),
      fetchTenantRows(prisma.loginActivityLog, tenantId, { orderBy: { createdAt: 'asc' } }),
    ]);
    appendSheet(XLSX, workbook, 'AuditLogs', [
      { key: 'auditRef', header: 'Audit Ref' }, { key: 'actorUserId', header: 'Actor User Ref' }, { key: 'actorName', header: 'Actor Name' },
      { key: 'actorRole', header: 'Actor Role' }, { key: 'actorEmail', header: 'Actor Email' }, { key: 'action', header: 'Action' },
      { key: 'module', header: 'Module' }, { key: 'entityType', header: 'Entity Type' }, { key: 'entityRef', header: 'Entity Ref' },
      { key: 'method', header: 'Method' }, { key: 'endpoint', header: 'Endpoint' }, { key: 'statusCode', header: 'Status Code' },
      { key: 'ip', header: 'IP' }, { key: 'summary', header: 'Summary' }, { key: 'metadata', header: 'Metadata' }, { key: 'createdAt', header: 'Created At' },
    ], auditLogs.map((row) => ({ auditRef: row.id, entityRef: row.entityId, ...row, actorEmail: row.actorEmail ? '[REDACTED_EMAIL]' : '', ip: row.ip ? '[REDACTED_IP]' : '', userAgent: '', metadata: jsonCell(row.metadata), createdAt: toIso(row.createdAt) })));
    appendSheet(XLSX, workbook, 'AccessAuditLogs', [
      { key: 'auditRef', header: 'Audit Ref' }, { key: 'action', header: 'Action' }, { key: 'userRef', header: 'User Ref' },
      { key: 'permission', header: 'Permission' }, { key: 'storeRef', header: 'Store Ref' }, { key: 'requestRef', header: 'Request Ref' },
      { key: 'actorRef', header: 'Actor Ref' }, { key: 'actorIp', header: 'Actor IP' }, { key: 'metadata', header: 'Metadata' }, { key: 'createdAt', header: 'Created At' },
    ], accessAuditLogs.map((row) => ({ auditRef: row.id, userRef: row.userId, storeRef: row.storeId, requestRef: row.requestId, actorRef: row.actorId, actorIp: row.actorIp ? '[REDACTED_IP]' : '', metadata: jsonCell(row.metadata), createdAt: toIso(row.createdAt) })));
    appendSheet(XLSX, workbook, 'LoginActivityLogs', [
      { key: 'logRef', header: 'Log Ref' }, { key: 'userRef', header: 'User Ref' }, { key: 'userType', header: 'User Type' },
      { key: 'name', header: 'Name' }, { key: 'email', header: 'Email' }, { key: 'username', header: 'Username' },
      { key: 'role', header: 'Role' }, { key: 'eventType', header: 'Event Type' }, { key: 'source', header: 'Source' },
      { key: 'status', header: 'Status' }, { key: 'ip', header: 'IP' }, { key: 'browser', header: 'Browser' }, { key: 'os', header: 'OS' },
      { key: 'failureReason', header: 'Failure Reason' }, { key: 'createdAt', header: 'Created At' },
    ], loginActivityLogs.map((row) => ({ logRef: row.id, userRef: row.userId, ...row, email: row.email ? '[REDACTED_EMAIL]' : '', ip: row.ip ? '[REDACTED_IP]' : '', userAgent: '', createdAt: toIso(row.createdAt) })));
  }

  return { XLSX, workbook };
};

export const createLicenseControlExportService = ({
  getPrismaClient = getPrisma,
  schedule = (fn) => setImmediate(fn),
} = {}) => {
  const service = {
    async createExport(payload = {}) {
      const externalLicenseId = cleanText(payload.externalLicenseId, 180);
      const externalTenantId = cleanText(payload.externalTenantId, 180);
      const scope = cleanText(payload.scope || 'tenant', 30).toLowerCase();
      if (scope !== 'tenant') {
        throw new AppError(400, 'Mevcut model sadece tenant bazli export destekler.', { errorCode: 'tenant_scope_required' });
      }

      const prisma = await getPrismaClient();
      const license = await findLicenseForExport(prisma, externalLicenseId, externalTenantId);
      const jobId = uuidv4();
      const downloadToken = createProviderDownloadToken({ id: jobId });
      const job = await prisma.exportJob.create({
        data: {
          id: jobId,
          tenantId: license.tenantId,
          licenseId: license.id,
          externalLicenseId: license.externalLicenseId,
          externalTenantId: externalTenantId || license.externalTenantId || license.tenant.externalTenantId || null,
          requestedByEmail: normalizeEmail(payload.requestedByEmail),
          status: EXPORT_STATUS.QUEUED,
          scope: 'tenant',
          includeAuditLogs: payload.includeAuditLogs === true,
          downloadTokenHash: hashOpaqueValue(downloadToken),
          requestId: cleanText(payload.requestId, 180) || null,
          callbackUrl: cleanText(payload.callbackUrl, 1000) || null,
          payload: {
            source: 'getshelfio_export_request',
          },
        },
      });

      schedule(() => {
        void service.processExportJob(job.id).catch((error) => {
          console.error('[tenant-export-job] failed', { jobId: job.id, message: error?.message || '' });
        });
      });

      return {
        jobId: job.id,
        status: job.status,
        scope: job.scope,
        externalLicenseId: job.externalLicenseId,
        externalTenantId: job.externalTenantId,
        downloadUrl: buildPublicDownloadUrl(downloadToken),
      };
    },

    async getStatus(jobId) {
      const prisma = await getPrismaClient();
      const job = await prisma.exportJob.findUnique({ where: { id: cleanText(jobId, 120) } });
      if (!job) {
        throw new AppError(404, 'Export job bulunamadi.', { errorCode: 'export_job_not_found' });
      }
      const providerToken = job.status === EXPORT_STATUS.READY && job.downloadExpiresAt
        ? createProviderDownloadToken(job)
        : null;
      if (providerToken && job.downloadTokenHash !== hashOpaqueValue(providerToken)) {
        await prisma.exportJob.update({
          where: { id: job.id },
          data: { downloadTokenHash: hashOpaqueValue(providerToken) },
        });
      }
      return {
        jobId: job.id,
        status: job.status,
        scope: job.scope,
        externalLicenseId: job.externalLicenseId,
        externalTenantId: job.externalTenantId,
        fileName: job.fileName || null,
        downloadUrl: job.status === EXPORT_STATUS.READY && providerToken ? buildPublicDownloadUrl(providerToken) : null,
        expiresAt: job.downloadExpiresAt || null,
        downloadCount: job.downloadCount,
        errorCode: job.errorCode || null,
        errorMessage: job.errorMessage || null,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
      };
    },

    async processExportJob(jobId) {
      const prisma = await getPrismaClient();
      const job = await prisma.exportJob.findUnique({
        where: { id: jobId },
        include: { tenant: true, license: true },
      });
      if (!job || job.status !== EXPORT_STATUS.QUEUED) return null;

      await prisma.exportJob.update({
        where: { id: job.id },
        data: { status: EXPORT_STATUS.RUNNING, startedAt: new Date(), errorCode: null, errorMessage: null },
      });

      try {
        const license = job.license || await prisma.license.findUnique({ where: { id: job.licenseId } });
        if (!license || license.tenantId !== job.tenantId) {
          throw new AppError(404, 'Export lisans mapping bulunamadi.', { errorCode: 'export_license_not_found' });
        }
        const { XLSX, workbook } = await buildWorkbook(prisma, {
          tenant: job.tenant,
          license,
          includeAuditLogs: job.includeAuditLogs,
        });
        const fileBasename = safeExportBasename(job.id);
        const filePath = resolveExportPath(fileBasename);
        await mkdir(path.resolve(config.exportStorageDir), { recursive: true });
        XLSX.writeFile(workbook, filePath, { bookType: 'xlsx' });

        const downloadExpiresAt = addDays(config.exportDownloadTtlHours);
        const downloadToken = createProviderDownloadToken(job);
        const readyJob = await prisma.exportJob.update({
          where: { id: job.id },
          data: {
            status: EXPORT_STATUS.READY,
            fileName: publicFileName(),
            fileBasename,
            downloadTokenHash: hashOpaqueValue(downloadToken),
            downloadExpiresAt,
            completedAt: new Date(),
          },
        });
        await maybePostCallback(readyJob, {
          success: true,
          data: {
            jobId: readyJob.id,
            status: readyJob.status,
            downloadUrl: buildPublicDownloadUrl(downloadToken),
            expiresAt: readyJob.downloadExpiresAt,
            requestId: readyJob.requestId || null,
          },
        });
        return readyJob;
      } catch (error) {
        const failed = await prisma.exportJob.update({
          where: { id: job.id },
          data: {
            status: EXPORT_STATUS.FAILED,
            errorCode: error?.errorCode || 'export_failed',
            errorMessage: cleanText(error?.message || 'Export tamamlanamadi.', 500),
            completedAt: new Date(),
          },
        });
        await maybePostCallback(failed, {
          success: false,
          data: {
            jobId: failed.id,
            status: failed.status,
            errorCode: failed.errorCode,
            requestId: failed.requestId || null,
          },
        });
        return failed;
      }
    },

    async downloadByToken(rawToken) {
      const token = cleanText(rawToken, 500);
      if (!token) {
        throw new AppError(404, 'Download linki bulunamadi.', { errorCode: 'download_token_not_found' });
      }
      const prisma = await getPrismaClient();
      const job = await prisma.exportJob.findUnique({ where: { downloadTokenHash: hashOpaqueValue(token) } });
      if (!job) {
        throw new AppError(404, 'Download linki bulunamadi.', { errorCode: 'download_token_not_found' });
      }
      if (job.status !== EXPORT_STATUS.READY) {
        throw new AppError(409, 'Export dosyasi hazir degil.', { errorCode: 'export_not_ready' });
      }
      if (!job.downloadExpiresAt || job.downloadExpiresAt.getTime() <= Date.now()) {
        await prisma.exportJob.update({ where: { id: job.id }, data: { status: EXPORT_STATUS.EXPIRED } });
        throw new AppError(410, 'Download linkinin suresi doldu.', { errorCode: 'download_token_expired' });
      }
      const filePath = resolveExportPath(job.fileBasename);
      try {
        await stat(filePath);
      } catch {
        throw new AppError(404, 'Export dosyasi bulunamadi.', { errorCode: 'export_file_not_found' });
      }
      const buffer = await readFile(filePath);
      const updated = await prisma.exportJob.update({
        where: { id: job.id },
        data: {
          downloadCount: { increment: 1 },
          lastDownloadedAt: new Date(),
        },
      });
      return {
        buffer,
        mimeType: XLSX_MIME,
        fileName: job.fileName || publicFileName(),
        job: updated,
      };
    },

    async cleanupExpiredExports(now = new Date()) {
      const prisma = await getPrismaClient();
      let expiredJobs = [];
      try {
        expiredJobs = await prisma.exportJob.findMany({
          where: {
            status: EXPORT_STATUS.READY,
            downloadExpiresAt: { lt: now },
            fileBasename: { not: null },
          },
          take: 100,
        });
      } catch (error) {
        if (isMissingExportJobTableError(error)) {
          return { expiredCount: 0, skipped: 'export_jobs_missing' };
        }
        throw error;
      }
      for (const job of expiredJobs) {
        try {
          await unlink(resolveExportPath(job.fileBasename));
        } catch {}
        await prisma.exportJob.update({
          where: { id: job.id },
          data: { status: EXPORT_STATUS.EXPIRED },
        });
      }
      return { expiredCount: expiredJobs.length };
    },
  };

  return service;
};

export const licenseControlExportService = createLicenseControlExportService();
