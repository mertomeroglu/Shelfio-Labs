import { getPrisma } from '../providers/postgresProvider.js';
import { getActiveStoreId, getActiveTenantId, MAIN_TENANT_ID } from '../tenant/tenantContext.js';
import { normalizeSearchText } from '../utils/validators.js';

const clone = (value) => JSON.parse(JSON.stringify(value ?? null));
const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

const toDate = (value) => {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const fromDate = (value) => (value instanceof Date ? value.toISOString() : value ?? null);
const toNumber = (value) => {
  if (value === null || value === undefined) return value;
  if (typeof value === 'object' && typeof value.toNumber === 'function') return value.toNumber();
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : value;
};

const toInt = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.floor(numeric) : null;
};

const toDecimal = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const toJson = (value, fallback = null) => {
  if (value === undefined) return fallback;
  return clone(value);
};

const pickDate = (item, key) => toDate(item?.[key]);

const MODEL_BY_FILE = {
  'accessAuditLogs.json': 'accessAuditLog',
  'accessRequests.json': 'accessRequest',
  'catalogImports.json': 'catalogImport',
  'categories.json': 'category',
  'customerOrders.json': 'customerOrder',
  'customers.json': 'customer',
  'dailyStoreClosings.json': 'dailyStoreClosing',
  'eslDevices.json': 'eslDevice',
  'eslHistory.json': 'eslHistory',
  'movements.json': 'stockMovement',
  'notifications.json': 'notification',
  'products.json': 'product',
  'purchaseOrderItems.json': 'purchaseOrderItem',
  'purchaseOrders.json': 'purchaseOrder',
  'purchaseSuggestions.json': 'purchaseSuggestion',
  'sales.json': 'sale',
  'sections.json': 'section',
  'supplierCatalogVersions.json': 'supplierCatalogVersion',
  'supplierProducts.json': 'supplierProduct',
  'suppliers.json': 'supplier',
  'supportTickets.json': 'supportTicket',
  'tasks.json': 'task',
  'temporaryPermissionGrants.json': 'temporaryPermissionGrant',
  'users.json': 'user',
  'warehouseLocations.json': 'warehouseLocation',
  'warehouseMovements.json': 'warehouseMovement',
  'stockTransferRequests.json': 'stockTransferRequest',
  'stockTransferRequestAudits.json': 'transferAudit',
  'storeLayouts.json': 'storeLayout',
  'storeLayoutItems.json': 'storeLayoutItem',
};

const FIELD_CONFIG = {
  user: {
    string: ['id', 'tenantId', 'username', 'passwordHash', 'role', 'assignedDeskCode', 'name', 'email', 'registerPin', 'storeId', 'department'],
    bool: ['isActive'],
    json: ['permissions'],
    date: ['lastLoginAt', 'createdAt', 'updatedAt'],
  },
  category: {
    string: ['id', 'tenantId', 'name', 'normalizedSearch', 'code', 'description', 'mainSectionName', 'mainStorageType'],
    int: ['mainSectionNo'],
    bool: ['requiresColdChain', 'requiresFreezer', 'isActive'],
    date: ['createdAt', 'updatedAt'],
  },
  section: {
    string: ['id', 'tenantId', 'name', 'description'],
    int: ['number'],
    bool: ['isActive'],
    date: ['createdAt', 'updatedAt'],
  },
  supplier: {
    string: ['id', 'tenantId', 'supplierCode', 'code', 'name', 'normalizedSearch', 'type', 'tedarikciTuru', 'website', 'delayStatus'],
    int: ['minimumOrderQty', 'minimumOrderCaseQty', 'linkedProductCount', 'productCount'],
    bool: ['isActive'],
    json: ['coveredCategories', 'categories'],
    date: ['createdAt', 'updatedAt'],
  },
  product: {
    string: [
      'id', 'tenantId', 'sku', 'barcode', 'name', 'normalizedSearch', 'brand', 'categoryId', 'supplierId', 'sectionId', 'shelfSide', 'shelfCode',
      'requiredStorageType', 'unit', 'etiket', 'placementPriority', 'catalogVisibility', 'orderActivatedStatus',
      'sourceSheet', 'depotAssignmentType', 'depotLocationCode', 'depotZoneCode', 'capacityMode', 'stockingStrategy',
      'depotLocationLabel', 'defaultWarehouseLocationCode', 'lastPriceChangeSource',
    ],
    int: ['shelfNo', 'shelfLevel', 'criticalStock', 'maxShelfStock', 'maxStock', 'unitsPerCase', 'casesPerPallet', 'unitsPerPallet', 'minimumOrderCaseQty', 'assignmentPriority'],
    decimal: ['purchasePrice', 'salePrice', 'averageDesi'],
    bool: ['isListed', 'registerOnOrder', 'isActive', 'isVirtualLocation'],
    json: ['alternativeWarehouseLocationCodes'],
    date: ['createdAt', 'updatedAt', 'priceUpdatedAt', 'lastPriceChangeDate', 'lastPriceChangeAt'],
  },
  stockMovement: {
    string: ['id', 'tenantId', 'productId', 'supplierId', 'productName', 'sku', 'type', 'location', 'fromLocation', 'toLocation', 'reasonCode', 'reasonLabel', 'referenceNo', 'transferRequestId', 'userId', 'userName', 'batchNo', 'skt'],
    int: ['qty', 'previousQuantity', 'nextQuantity', 'previousTotalQuantity', 'nextTotalQuantity'],
    date: ['createdAt', 'updatedAt'],
  },
  warehouseLocation: {
    string: ['id', 'tenantId', 'side', 'locationCode', 'storageType', 'status', 'productId', 'productName', 'sku', 'barcode', 'supplierId', 'supplierName', 'batchNo', 'skt'],
    int: ['rowNo', 'shelfNo', 'levelNo', 'palletCount', 'palletCapacity', 'warehouseStock'],
    decimal: ['occupancy'],
    bool: ['isReserved', 'isBlocked'],
    date: ['createdAt', 'updatedAt'],
  },
  warehouseMovement: {
    string: ['id', 'tenantId', 'productId', 'productName', 'sku', 'barcode', 'supplierId', 'supplierName', 'locationId', 'locationCode', 'batchNo', 'skt', 'movementType', 'createdBy', 'createdByName', 'description'],
    int: ['qty'],
    date: ['createdAt'],
  },
  supplierProduct: {
    string: ['id', 'tenantId', 'productId', 'supplierId', 'supplierProductCode', 'supplierProductName', 'normalizedSearch', 'supplierSku', 'barcode', 'currency', 'source', 'priceUnit', 'minOrderUnit', 'defaultOrderUnit'],
    int: ['minimumOrderQty', 'minOrderQty', 'leadTimeDays', 'unitsPerCase', 'casesPerPallet'],
    decimal: ['purchasePrice'],
    bool: ['isDefault', 'isActive'],
    date: ['createdAt', 'updatedAt'],
  },
  purchaseSuggestion: {
    string: ['id', 'tenantId', 'productId', 'categoryId', 'supplierId', 'status', 'reason', 'riskLevel'],
    int: ['currentStock', 'criticalStock', 'suggestedQty'],
    decimal: ['unitPrice', 'totalPrice'],
    date: ['createdAt', 'updatedAt'],
  },
  purchaseOrder: {
    string: ['id', 'tenantId', 'orderNumber', 'supplierId', 'source', 'status', 'currentStatus', 'currency', 'deliveryStatus', 'stockEntryMode', 'createdBy', 'warehouseCity', 'deliveryLocation', 'orderReason', 'priority', 'logisticsProvider', 'trackingNo', 'estimatedDeliveryDate'],
    decimal: ['subtotalAmount', 'taxAmount', 'shippingFee', 'discountAmount', 'grandTotal', 'totalAmount'],
    bool: ['goodsReceiptCompleted', 'stockEntryCompleted', 'archived'],
    date: ['createdAt', 'updatedAt', 'approvedAt', 'deliveredAt', 'completedAt', 'archivedAt'],
  },
  purchaseOrderItem: {
    string: ['id', 'tenantId', 'orderId', 'productId', 'unit'],
    int: ['quantity'],
    decimal: ['unitPrice', 'totalPrice', 'taxRate', 'taxAmount'],
    date: ['createdAt', 'updatedAt'],
  },
  sale: {
    string: ['id', 'tenantId', 'referenceNo', 'type', 'deskCode', 'cashierId', 'cashierName', 'paymentMethod', 'originalSaleRef', 'status'],
    decimal: ['subtotal', 'discount', 'totalAmount'],
    json: ['items', 'payments', 'customer'],
    date: ['createdAt', 'updatedAt'],
  },
  dailyStoreClosing: {
    string: ['id', 'tenantId', 'storeId', 'timezone', 'source', 'closingType'],
    int: ['salesCount', 'returnCount', 'transactionCount', 'itemCount'],
    decimal: ['grossSalesAmount', 'returnAmount', 'netRevenue'],
    date: ['businessDate', 'closedAt', 'createdAt', 'updatedAt'],
  },
  customer: {
    string: ['id', 'tenantId', 'customerNo', 'name', 'phone', 'email', 'passwordHash', 'city', 'district'],
    int: ['totalOrders'],
    decimal: ['totalSpent'],
    bool: ['isActive'],
    json: ['discounts', 'giftCards'],
    date: ['createdAt', 'updatedAt'],
  },
  customerOrder: {
    string: ['id', 'tenantId', 'customerId', 'status'],
    decimal: ['totalAmount'],
    json: ['items'],
    date: ['createdAt', 'updatedAt'],
  },
  task: {
    string: ['id', 'tenantId', 'taskNo', 'title', 'description', 'assignedTo', 'priority', 'dueDate', 'status', 'createdBy'],
    json: ['comments'],
    date: ['createdAt', 'updatedAt'],
  },
  notification: {
    string: ['id', 'tenantId', 'userId', 'type', 'title', 'message', 'severity', 'relatedTaskId', 'dedupeKey', 'actionUrl', 'actionType', 'createdBy'],
    bool: ['isRead'],
    json: ['audience', 'delivery', 'payload'],
    date: ['createdAt'],
  },
  stockTransferRequest: {
    string: ['id', 'tenantId', 'productId', 'productName', 'sku', 'barcode', 'sectionId', 'sectionName', 'sourceLocation', 'targetLocation', 'status', 'priority', 'origin', 'source', 'requestedBy', 'requestedByName', 'handledBy', 'handledByName', 'note', 'handledNote'],
    int: ['sectionNumber', 'quantity', 'warehouseStockSnapshot', 'shelfStockSnapshot'],
    json: ['payload'],
    date: ['createdAt', 'completedAt', 'stockTransferredAt', 'updatedAt'],
  },
  transferAudit: {
    string: ['id', 'tenantId', 'transferRequestId', 'fromStatus', 'toStatus', 'note', 'actorId', 'actorName', 'event', 'origin'],
    date: ['createdAt'],
  },
  eslDevice: {
    string: ['id', 'tenantId', 'name', 'macAddress', 'model', 'firmwareVersion', 'status', 'assignedProductId', 'location', 'ipAddress'],
    int: ['batteryLevel'],
    bool: ['isDeleted'],
    date: ['lastSyncAt', 'deletedAt', 'createdAt', 'updatedAt'],
  },
  eslHistory: {
    string: ['id', 'tenantId', 'deviceId', 'deviceName', 'productId', 'productName', 'productSku', 'productBarcode', 'template', 'status'],
    decimal: ['salePrice'],
    json: ['customFields'],
    date: ['createdAt'],
  },
  accessRequest: {
    string: ['id', 'tenantId', 'userId', 'storeId', 'permission', 'reason', 'status', 'createdBy', 'reviewedBy', 'assignedTo', 'reviewNote'],
    int: ['requestedDurationMinutes'],
    date: ['createdAt', 'updatedAt', 'reviewedAt'],
  },
  temporaryPermissionGrant: {
    string: ['id', 'tenantId', 'userId', 'permission', 'storeId', 'requestId', 'status', 'approvedBy', 'reason', 'revokedBy'],
    date: ['createdAt', 'updatedAt', 'expiresAt', 'revokedAt'],
  },
  accessAuditLog: {
    string: ['id', 'tenantId', 'action', 'userId', 'permission', 'storeId', 'requestId', 'actorId', 'actorIp'],
    json: ['metadata'],
    date: ['createdAt'],
  },
  catalogImport: {
    string: ['id', 'tenantId', 'supplierId', 'supplierName', 'fileName', 'uploadedBy', 'status'],
    bool: ['requiredApproval', 'columnsValidated'],
    json: ['summary', 'rows'],
    date: ['uploadedAt', 'validityStart', 'validityEnd'],
  },
  supplierCatalogVersion: {
    string: ['id', 'tenantId', 'supplierId', 'status'],
    json: ['rows'],
    date: ['createdAt', 'updatedAt'],
  },
  supportTicket: {
    string: ['id', 'tenantId', 'subject', 'description', 'userId', 'user', 'role', 'page', 'browser', 'status'],
    json: ['attachments'],
    date: ['createdAt', 'updatedAt'],
  },
  storeLayout: {
    string: ['id', 'tenantId', 'storeId', 'name', 'status', 'publishedBy', 'createdBy'],
    int: ['version', 'canvasWidth', 'canvasHeight'],
    json: ['metadata'],
    date: ['publishedAt', 'createdAt', 'updatedAt'],
  },
  storeLayoutItem: {
    string: ['id', 'tenantId', 'layoutId', 'objectType', 'label', 'sectionId'],
    int: ['x', 'y', 'width', 'height', 'rotation', 'zIndex', 'sortOrder'],
    json: ['properties'],
    date: ['createdAt', 'updatedAt'],
  },
};

const ALIASES = {
  current_status: 'currentStatus',
  goods_receipt_completed: 'goodsReceiptCompleted',
  stock_entry_completed: 'stockEntryCompleted',
};

const NULL_IF_BLANK = new Set([
  'barcode',
  'categoryId',
  'code',
  'productId',
  'sectionId',
  'supplierId',
  'orderNumber',
  'customerNo',
  'macAddress',
  'referenceNo',
  'handledBy',
  'requestedBy',
  'actorId',
]);

const PURCHASE_SUGGESTION_COLUMN_FIELDS = [
  'id',
  'productId',
  'categoryId',
  'supplierId',
  'currentStock',
  'criticalStock',
  'suggestedQty',
  'unitPrice',
  'totalPrice',
  'status',
  'reason',
  'riskLevel',
  'createdAt',
  'updatedAt',
];

const PURCHASE_SUGGESTION_CALCULATION_FIELDS = [
  'supplierProductId',
  'reorderPoint',
  'targetStock',
  'grossNeedQty',
  'netNeedQty',
  'inboundConfirmedQty',
  'inboundEffectiveQty',
  'inboundNearTermQty',
  'inboundStatusTotals',
  'inboundLines',
  'suggestedCases',
  'palletQty',
  'roundedFromQty',
  'roundingUnit',
  'leadTimeDays',
  'daysToStockout',
  'sold7',
  'sold14',
  'sold30',
  'avgDaily7',
  'avgDaily14',
  'avgDaily30',
  'trendDirection',
  'trendRatio',
  'salesSpeed',
  'generationMode',
  'campaignId',
  'campaignName',
  'campaignType',
  'campaignDiscountRate',
  'minimumOrderQty',
  'minimumOrderUnit',
  'minimumOrderBaseQty',
  'priceUnit',
  'orderUnit',
  'unitsPerCase',
  'unitsPerPallet',
  'demandCoverageDays',
  'reasonText',
  'reasonTags',
  'reasonDetails',
  'calculatedAt',
  'calculationVersion',
  'supplierSelectionScore',
  'supplierSelectionReason',
  'confidenceScore',
  'eligibility',
];

const PURCHASE_SUGGESTION_WORKFLOW_FIELDS = [
  'linkedOrderId',
  'approvedBy',
  'approvedAt',
  'convertedBy',
  'convertedAt',
  'rejectedBy',
  'rejectedAt',
  'updatedBy',
];

const pickDefined = (source = {}, keys = []) => keys.reduce((acc, key) => {
  if (source[key] !== undefined) acc[key] = source[key];
  return acc;
}, {});

const normalizePurchaseSuggestionPayload = (source = {}) => {
  const rawPayload = isObject(source.payload) ? clone(source.payload) : {};
  const legacyCalculation = {
    ...pickDefined(rawPayload, PURCHASE_SUGGESTION_CALCULATION_FIELDS),
    ...pickDefined(source, PURCHASE_SUGGESTION_CALCULATION_FIELDS),
  };
  const calculation = {
    ...(isObject(rawPayload.calculation) ? rawPayload.calculation : {}),
    ...legacyCalculation,
  };
  const workflow = {
    ...(isObject(rawPayload.workflow) ? rawPayload.workflow : {}),
    ...pickDefined(rawPayload, PURCHASE_SUGGESTION_WORKFLOW_FIELDS),
    ...pickDefined(source, PURCHASE_SUGGESTION_WORKFLOW_FIELDS),
  };
  const audit = {
    ...(isObject(rawPayload.audit) ? rawPayload.audit : {}),
    generatedBy: source.generatedBy ?? rawPayload.generatedBy ?? rawPayload.audit?.generatedBy ?? null,
    generationOptions: isObject(source.generationOptions)
      ? source.generationOptions
      : (isObject(rawPayload.generationOptions) ? rawPayload.generationOptions : rawPayload.audit?.generationOptions),
    legacyPayloadMigrated: rawPayload.contractVersion !== 2 && Object.keys(rawPayload).length > 0 ? true : undefined,
  };

  Object.keys(calculation).forEach((key) => calculation[key] === undefined && delete calculation[key]);
  Object.keys(workflow).forEach((key) => workflow[key] === undefined && delete workflow[key]);
  Object.keys(audit).forEach((key) => audit[key] === undefined && delete audit[key]);

  return {
    contractVersion: 2,
    calculation,
    workflow,
    audit,
  };
};

const TENANT_SCOPED_MODELS = new Set([
  'accessAuditLog', 'accessRequest', 'catalogImport', 'category', 'customer', 'customerOrder',
  'dailyStoreClosing', 'eslDevice', 'eslHistory', 'notification', 'product', 'purchaseOrder',
  'purchaseOrderItem', 'purchaseSuggestion', 'sale', 'section', 'setting', 'stock', 'stockBatch',
  'stockMovement', 'stockTransferRequest', 'supplier', 'supplierCatalogVersion', 'supplierProduct',
  'supportTicket', 'task', 'temporaryPermissionGrant', 'transferAudit', 'user', 'warehouseLocation',
  'warehouseMovement',
]);

const STORE_SCOPED_MODELS = new Set(['accessRequest', 'dailyStoreClosing', 'temporaryPermissionGrant', 'user']);

const tenantWhere = (modelName, extra = {}) => (
  TENANT_SCOPED_MODELS.has(modelName)
    ? { ...extra, tenantId: getActiveTenantId() }
    : extra
);

const withTenantData = (modelName, data = {}) => {
  if (!TENANT_SCOPED_MODELS.has(modelName)) return data;
  const next = { ...data, tenantId: data.tenantId || getActiveTenantId() || MAIN_TENANT_ID };
  if (STORE_SCOPED_MODELS.has(modelName) && !next.storeId) {
    next.storeId = getActiveStoreId();
  }
  return next;
};

const mapPurchaseSuggestionToDb = (item) => {
  const source = mapIncomingAliases(item || {});
  const data = { payload: toJson(normalizePurchaseSuggestionPayload(source)) };
  const config = FIELD_CONFIG.purchaseSuggestion;

  for (const key of config.string || []) {
    if (source[key] !== undefined) data[key] = source[key] === null ? null : String(source[key]);
    if (NULL_IF_BLANK.has(key) && data[key] === '') data[key] = null;
  }
  for (const key of config.int || []) {
    if (source[key] !== undefined) data[key] = source[key] === null ? null : toInt(source[key]);
  }
  for (const key of config.decimal || []) {
    if (source[key] !== undefined) data[key] = toDecimal(source[key]);
  }
  for (const key of config.date || []) {
    if (source[key] !== undefined) data[key] = pickDate(source, key);
  }

  return withTenantData('purchaseSuggestion', data);
};

const mapPurchaseSuggestionFromDb = (row) => {
  if (!row) return null;
  const rawPayload = isObject(row.payload) ? clone(row.payload) : {};
  const calculation = isObject(rawPayload.calculation) ? clone(rawPayload.calculation) : {};
  const workflow = isObject(rawPayload.workflow) ? clone(rawPayload.workflow) : {};
  const legacyPayload = rawPayload.contractVersion === 2 ? {} : rawPayload;

  const out = {
    ...pickDefined(legacyPayload, PURCHASE_SUGGESTION_CALCULATION_FIELDS),
    ...calculation,
    ...pickDefined(legacyPayload, PURCHASE_SUGGESTION_WORKFLOW_FIELDS),
    ...workflow,
    payload: rawPayload,
    payloadContractVersion: rawPayload.contractVersion || 1,
  };

  const config = FIELD_CONFIG.purchaseSuggestion;
  const keys = [
    ...(config.string || []),
    ...(config.int || []),
    ...(config.decimal || []),
    ...(config.date || []),
  ];

  for (const key of keys) {
    if (!(key in row) || row[key] === undefined) continue;
    if (row[key] === null) {
      out[key] = null;
    } else if ((config.date || []).includes(key)) {
      out[key] = fromDate(row[key]);
    } else if ((config.decimal || []).includes(key)) {
      out[key] = toNumber(row[key]);
    } else {
      out[key] = clone(row[key]);
    }
  }

  if (row.id !== undefined) out.id = row.id;

  const drift = {};
  for (const key of PURCHASE_SUGGESTION_COLUMN_FIELDS) {
    if (legacyPayload[key] === undefined || row[key] === undefined || row[key] === null) continue;
    const rowValue = (FIELD_CONFIG.purchaseSuggestion.date || []).includes(key) ? fromDate(row[key]) : toNumber(row[key]);
    if (JSON.stringify(rowValue) !== JSON.stringify(legacyPayload[key])) {
      drift[key] = { column: rowValue, payload: legacyPayload[key] };
    }
  }
  if (Object.keys(drift).length) out.payloadColumnDrift = drift;

  return out;
};

const mapIncomingAliases = (item) => {
  const next = { ...item };
  Object.entries(ALIASES).forEach(([from, to]) => {
    if (next[to] === undefined && next[from] !== undefined) {
      next[to] = next[from];
    }
  });
  return next;
};

const mapToDb = (modelName, item) => {
  if (modelName === 'purchaseSuggestion') return mapPurchaseSuggestionToDb(item);

  const config = FIELD_CONFIG[modelName] || {};
  const source = mapIncomingAliases(item || {});
  const data = { payload: toJson(item || {}) };

  for (const key of config.string || []) {
    if (source[key] !== undefined) data[key] = source[key] === null ? null : String(source[key]);
    if (NULL_IF_BLANK.has(key) && data[key] === '') data[key] = null;
  }
  for (const key of config.int || []) {
    if (source[key] !== undefined) data[key] = source[key] === null ? null : toInt(source[key]);
  }
  for (const key of config.decimal || []) {
    if (source[key] !== undefined) data[key] = toDecimal(source[key]);
  }
  for (const key of config.bool || []) {
    if (source[key] !== undefined) data[key] = source[key] === null ? null : Boolean(source[key]);
  }
  for (const key of config.json || []) {
    if (source[key] !== undefined) data[key] = toJson(source[key]);
  }
  for (const key of config.date || []) {
    if (source[key] !== undefined) data[key] = pickDate(source, key);
  }

  if (modelName === 'product') {
    if (source.name !== undefined || source.brand !== undefined || source.etiket !== undefined || source.sku !== undefined || source.barcode !== undefined) {
      const name = source.name !== undefined ? String(source.name || '') : '';
      const brand = source.brand !== undefined ? String(source.brand || '') : '';
      const etiket = source.etiket !== undefined ? String(source.etiket || '') : '';
      const sku = source.sku !== undefined ? String(source.sku || '') : '';
      const barcode = source.barcode !== undefined ? String(source.barcode || '') : '';
      data.normalizedSearch = normalizeSearchText(`${name} ${brand} ${etiket} ${sku} ${barcode}`);
    }
  } else if (modelName === 'category') {
    if (source.name !== undefined) {
      data.normalizedSearch = normalizeSearchText(String(source.name || ''));
    }
  } else if (modelName === 'supplier') {
    if (source.name !== undefined) {
      data.normalizedSearch = normalizeSearchText(String(source.name || ''));
    }
  } else if (modelName === 'supplierProduct') {
    if (source.supplierProductName !== undefined || source.supplierSku !== undefined || source.barcode !== undefined) {
      const supplierProductName = source.supplierProductName !== undefined ? String(source.supplierProductName || '') : '';
      const supplierSku = source.supplierSku !== undefined ? String(source.supplierSku || '') : '';
      const barcode = source.barcode !== undefined ? String(source.barcode || '') : '';
      data.normalizedSearch = normalizeSearchText(`${supplierProductName} ${supplierSku} ${barcode}`);
    }
  }

  return withTenantData(modelName, data);
};

const mapFromDb = (modelName, row) => {
  if (!row) return null;
  if (modelName === 'purchaseSuggestion') return mapPurchaseSuggestionFromDb(row);

  const config = FIELD_CONFIG[modelName] || {};
  const payload = isObject(row.payload) ? clone(row.payload) : {};
  const out = { ...payload };
  const keys = [
    ...(config.string || []),
    ...(config.int || []),
    ...(config.decimal || []),
    ...(config.bool || []),
    ...(config.json || []),
    ...(config.date || []),
  ];

  for (const key of keys) {
    if (!(key in row) || row[key] === undefined) continue;
    if (row[key] === null) {
      out[key] = null;
    } else if ((config.date || []).includes(key)) {
      out[key] = fromDate(row[key]);
    } else if ((config.decimal || []).includes(key)) {
      out[key] = toNumber(row[key]);
    } else {
      out[key] = clone(row[key]);
    }
  }

  if (row.id !== undefined) out.id = row.id;
  if (modelName === 'purchaseOrder') {
    out.current_status = out.current_status ?? out.currentStatus;
    out.goods_receipt_completed = out.goods_receipt_completed ?? out.goodsReceiptCompleted;
    out.stock_entry_completed = out.stock_entry_completed ?? out.stockEntryCompleted;
  }
  return out;
};

const findByRepositoryId = async ({ delegate, modelName, idKey, id }) => {
  if (idKey === 'id') return delegate.findFirst({ where: tenantWhere(modelName, { id }) });
  const rows = await delegate.findMany({ where: tenantWhere(modelName, { [idKey]: id }), take: 1 });
  return rows[0] || null;
};

const updateByRepositoryId = async ({ delegate, modelName, idKey, id, updater }) => {
  const existingRow = await findByRepositoryId({ delegate, modelName, idKey, id });
  if (!existingRow) return null;

  const existing = mapFromDb(modelName, existingRow);
  const nextValue = typeof updater === 'function' ? updater(existing) : updater;
  const data = mapToDb(modelName, nextValue);
  const where = idKey === 'id' ? { id } : { id: existingRow.id };
  const updated = await delegate.update({ where, data });
  return mapFromDb(modelName, updated);
};

const deleteByRepositoryId = async ({ delegate, modelName, idKey, id }) => {
  const existingRow = await findByRepositoryId({ delegate, modelName, idKey, id });
  if (!existingRow) return null;
  const where = idKey === 'id' ? { id } : { id: existingRow.id };
  const deleted = await delegate.delete({ where });
  return mapFromDb(modelName, deleted);
};

const createGenericPostgresRepository = ({ modelName, idKey = 'id', client = null }) => {
  const getDelegate = async () => {
    const prisma = client || await getPrisma();
    const delegate = prisma[modelName];
    if (!delegate) throw new Error(`Prisma model not configured for ${modelName}`);
    return delegate;
  };

  const getAll = async () => {
    const delegate = await getDelegate();
    const rows = await delegate.findMany({ where: tenantWhere(modelName) });
    return rows.map((row) => mapFromDb(modelName, row));
  };

  const findById = async (id) => {
    const delegate = await getDelegate();
    return mapFromDb(modelName, await findByRepositoryId({ delegate, modelName, idKey, id }));
  };

  const writeData = async (items) => {
    const delegate = await getDelegate();
    if (!Array.isArray(items)) return items;
    if (items.length === 0) {
      await delegate.deleteMany({ where: tenantWhere(modelName) });
      return [];
    }

    const created = [];
    for (const item of items) {
      const data = mapToDb(modelName, item);
      const row = await delegate.upsert({
        where: { id: data.id },
        create: data,
        update: data,
      });
      created.push(mapFromDb(modelName, row));
    }
    return created;
  };

  return {
    filePath: `postgres://${modelName}`,
    ensureFile: async () => {},
    readData: getAll,
    writeData,
    getAll,
    findById,
    async findOne(predicate) {
      const all = await getAll();
      return all.find(predicate) || null;
    },
    async create(item) {
      const delegate = await getDelegate();
      const row = await delegate.create({ data: mapToDb(modelName, item) });
      return mapFromDb(modelName, row);
    },
    async updateById(id, updater) {
      const delegate = await getDelegate();
      return updateByRepositoryId({ delegate, modelName, idKey, id, updater });
    },
    async deleteById(id) {
      const delegate = await getDelegate();
      return deleteByRepositoryId({ delegate, modelName, idKey, id });
    },
  };
};

const toNestedId = (prefix, parentId, index, row = {}) => String(row.id || `${prefix}-${parentId}-${index + 1}`);

const safeActorId = (value) => {
  const id = String(value || '').trim();
  return id && id !== 'system' ? id : null;
};

const saleItemData = ({ saleId, item, index }) => ({
  id: toNestedId('sale-item', saleId, index, item),
  tenantId: item?.tenantId || getActiveTenantId(),
  saleId,
  productId: item?.productId && item.productId !== '__bag__' ? String(item.productId) : null,
  barcode: item?.barcode || null,
  name: item?.name || null,
  sku: item?.sku || null,
  quantity: toInt(item?.quantity),
  vatRate: toDecimal(item?.vatRate),
  unitPrice: toDecimal(item?.unitPrice),
  totalPrice: toDecimal(item?.totalPrice),
  payload: toJson(item || {}),
});

const purchaseStatusData = ({ orderId, item, index }) => ({
  id: toNestedId('po-status', orderId, index, item),
  tenantId: item?.tenantId || getActiveTenantId(),
  orderId,
  status: item?.status || null,
  at: toDate(item?.at),
  by: safeActorId(item?.by),
  note: item?.note || null,
  payload: toJson(item || {}),
});

const purchaseActivityData = ({ orderId, item, index }) => ({
  id: toNestedId('po-activity', orderId, index, item),
  tenantId: item?.tenantId || getActiveTenantId(),
  orderId,
  type: item?.type || null,
  status: item?.status || null,
  at: toDate(item?.at),
  by: safeActorId(item?.by),
  note: item?.note || null,
  payload: toJson(item || {}),
});

const taskCommentData = ({ taskId, item, index }) => ({
  id: toNestedId('task-comment', taskId, index, item),
  tenantId: item?.tenantId || getActiveTenantId(),
  taskId,
  text: item?.text || null,
  authorId: safeActorId(item?.authorId),
  authorName: item?.authorName || null,
  createdAt: toDate(item?.createdAt),
  payload: toJson(item || {}),
});

const mapNestedPayload = (row) => ({
  ...(isObject(row?.payload) ? clone(row.payload) : {}),
  id: row?.id,
});

const mapSaleItemFromDb = (row) => ({
  ...mapNestedPayload(row),
  productId: row.productId || undefined,
  barcode: row.barcode || '',
  name: row.name || '',
  sku: row.sku || '',
  quantity: row.quantity || 0,
  vatRate: toNumber(row.vatRate) ?? undefined,
  unitPrice: toNumber(row.unitPrice) ?? 0,
  totalPrice: toNumber(row.totalPrice) ?? 0,
});

const mapPurchaseStatusFromDb = (row) => ({
  ...mapNestedPayload(row),
  status: row.status || '',
  at: fromDate(row.at),
  by: row.by || undefined,
  note: row.note || undefined,
});

const mapPurchaseActivityFromDb = (row) => ({
  ...mapNestedPayload(row),
  type: row.type || '',
  status: row.status || undefined,
  at: fromDate(row.at),
  by: row.by || undefined,
  note: row.note || undefined,
});

const mapTaskCommentFromDb = (row) => ({
  ...mapNestedPayload(row),
  text: row.text || '',
  authorId: row.authorId || null,
  authorName: row.authorName || 'Sistem',
  createdAt: fromDate(row.createdAt),
});

const syncNestedRows = async ({ prisma, parentModel, parentId, data }) => {
  if (parentModel === 'sale') {
    await prisma.saleItem.deleteMany({ where: { saleId: parentId } });
    for (const [index, item] of (Array.isArray(data.items) ? data.items : []).entries()) {
      await prisma.saleItem.create({ data: saleItemData({ saleId: parentId, item, index }) });
    }
  }

  if (parentModel === 'purchaseOrder') {
    await prisma.purchaseOrderStatusHistory.deleteMany({ where: { orderId: parentId } });
    await prisma.purchaseOrderActivityLog.deleteMany({ where: { orderId: parentId } });
    for (const [index, item] of (Array.isArray(data.statusHistory) ? data.statusHistory : []).entries()) {
      await prisma.purchaseOrderStatusHistory.create({ data: purchaseStatusData({ orderId: parentId, item, index }) });
    }
    for (const [index, item] of (Array.isArray(data.activityLog) ? data.activityLog : []).entries()) {
      await prisma.purchaseOrderActivityLog.create({ data: purchaseActivityData({ orderId: parentId, item, index }) });
    }
  }

  if (parentModel === 'task') {
    await prisma.taskComment.deleteMany({ where: { taskId: parentId } });
    for (const [index, item] of (Array.isArray(data.comments) ? data.comments : []).entries()) {
      await prisma.taskComment.create({ data: taskCommentData({ taskId: parentId, item, index }) });
    }
  }
};

const createNestedPostgresRepository = ({ modelName, client = null }) => {
  const include = modelName === 'sale'
    ? { saleItems: true }
    : modelName === 'purchaseOrder'
      ? { statusHistory: true, activityLogs: true }
      : { commentRows: true };

  const getPrismaClient = async () => client || await getPrisma();
  const mapRow = (row) => {
    const mapped = mapFromDb(modelName, row);
    if (!mapped) return null;

    if (modelName === 'sale') {
      mapped.items = Array.isArray(row.saleItems) ? row.saleItems.map(mapSaleItemFromDb) : (mapped.items || []);
    }
    if (modelName === 'purchaseOrder') {
      mapped.statusHistory = Array.isArray(row.statusHistory) ? row.statusHistory.map(mapPurchaseStatusFromDb) : (mapped.statusHistory || []);
      mapped.activityLog = Array.isArray(row.activityLogs) ? row.activityLogs.map(mapPurchaseActivityFromDb) : (mapped.activityLog || []);
    }
    if (modelName === 'task') {
      mapped.comments = Array.isArray(row.commentRows) ? row.commentRows.map(mapTaskCommentFromDb) : (mapped.comments || []);
    }

    return mapped;
  };

  return {
    filePath: `postgres://${modelName}`,
    ensureFile: async () => {},
    async readData() {
      return this.getAll();
    },
    async writeData(items) {
      const prisma = await getPrismaClient();
      if (!Array.isArray(items)) return items;
      if (items.length === 0) {
        await prisma[modelName].deleteMany({ where: tenantWhere(modelName) });
        return [];
      }
      const rows = [];
      for (const item of items) {
        const data = mapToDb(modelName, item);
        const row = await prisma[modelName].upsert({
          where: { id: data.id },
          create: data,
          update: data,
          include,
        });
        await syncNestedRows({ prisma, parentModel: modelName, parentId: row.id, data: item });
        rows.push(await prisma[modelName].findUnique({ where: { id: row.id }, include }).then(mapRow));
      }
      return rows;
    },
    async getAll() {
      const prisma = await getPrismaClient();
      const rows = await prisma[modelName].findMany({ where: tenantWhere(modelName), include });
      return rows.map(mapRow);
    },
    async findById(id) {
      const prisma = await getPrismaClient();
      return mapRow(await prisma[modelName].findFirst({ where: tenantWhere(modelName, { id }), include }));
    },
    async findOne(predicate) {
      const all = await this.getAll();
      return all.find(predicate) || null;
    },
    async create(item) {
      const prisma = await getPrismaClient();
      const row = await prisma[modelName].create({ data: mapToDb(modelName, item) });
      await syncNestedRows({ prisma, parentModel: modelName, parentId: row.id, data: item });
      return this.findById(row.id);
    },
    async updateById(id, updater) {
      const existing = await this.findById(id);
      if (!existing) return null;
      const nextValue = typeof updater === 'function' ? updater(existing) : updater;
      const prisma = await getPrismaClient();
      const row = await prisma[modelName].update({
        where: { id },
        data: mapToDb(modelName, nextValue),
      });
      await syncNestedRows({ prisma, parentModel: modelName, parentId: row.id, data: nextValue });
      return this.findById(row.id);
    },
    async deleteById(id) {
      const prisma = await getPrismaClient();
      const existing = await this.findById(id);
      if (!existing) return null;
      await prisma[modelName].delete({ where: { id } });
      return existing;
    },
  };
};

const mapStockFromDb = (row) => {
  if (!row) return null;
  const payload = isObject(row.payload) ? clone(row.payload) : {};
  const batches = Array.isArray(row.batches)
    ? row.batches.map((batch) => ({
      ...(isObject(batch.payload) ? clone(batch.payload) : {}),
      id: batch.id,
      batchNo: batch.batchNo,
      skt: batch.skt || '',
      warehouseQuantity: batch.warehouseQuantity || 0,
      shelfQuantity: batch.shelfQuantity || 0,
      totalQuantity: batch.totalQuantity || 0,
      status: batch.status || '',
    }))
    : [];

  return {
    ...payload,
    id: row.id,
    tenantId: row.tenantId || MAIN_TENANT_ID,
    productId: row.productId,
    warehouseQuantity: row.warehouseQuantity || 0,
    shelfQuantity: row.shelfQuantity || 0,
    quantity: row.quantity || 0,
    onHand: row.onHand || 0,
    available: row.available || 0,
    reserved: row.reserved || 0,
    batches,
    batchCount: row.batchCount ?? batches.filter((item) => Number(item.totalQuantity || 0) > 0).length,
    nearestExpiry: row.nearestExpiry || '',
    fefoDefaultBatchNo: row.fefoDefaultBatchNo || '',
    fefoDefaultExpiry: row.fefoDefaultExpiry || '',
    updatedAt: fromDate(row.updatedAt) || payload.updatedAt,
  };
};

const deriveBatchSummaryForStockData = (batches = []) => {
  const active = (Array.isArray(batches) ? batches : [])
    .map((batch) => ({
      batchNo: String(batch?.batchNo || '').trim(),
      skt: String(batch?.skt || '').trim(),
      totalQuantity: toInt(batch?.totalQuantity) ?? ((toInt(batch?.warehouseQuantity) || 0) + (toInt(batch?.shelfQuantity) || 0)),
    }))
    .filter((batch) => batch.batchNo && batch.totalQuantity > 0);
  const fefo = active
    .filter((batch) => batch.skt)
    .sort((left, right) => left.skt.localeCompare(right.skt) || left.batchNo.localeCompare(right.batchNo, 'tr'))[0] || null;
  return {
    batchCount: active.length,
    nearestExpiry: fefo?.skt || null,
    fefoDefaultBatchNo: fefo?.batchNo || null,
    fefoDefaultExpiry: fefo?.skt || null,
  };
};

const stockData = (item = {}) => {
  const batchSummary = deriveBatchSummaryForStockData(item.batches || []);
  return withTenantData('stock', {
    productId: String(item.productId || ''),
    warehouseQuantity: toInt(item.warehouseQuantity) || 0,
    shelfQuantity: toInt(item.shelfQuantity) || 0,
    quantity: toInt(item.quantity) ?? ((toInt(item.warehouseQuantity) || 0) + (toInt(item.shelfQuantity) || 0)),
    onHand: toInt(item.onHand) ?? toInt(item.quantity) ?? 0,
    available: toInt(item.available) ?? toInt(item.quantity) ?? 0,
    reserved: toInt(item.reserved) || 0,
    batchCount: batchSummary.batchCount,
    nearestExpiry: batchSummary.nearestExpiry,
    fefoDefaultBatchNo: batchSummary.fefoDefaultBatchNo,
    fefoDefaultExpiry: batchSummary.fefoDefaultExpiry,
    payload: toJson({ ...item, batches: undefined, productBatches: undefined, batchNo: undefined, skt: undefined, expiryDate: undefined }),
    updatedAt: toDate(item.updatedAt) || new Date(),
  });
};

const syncStockBatches = async (prisma, stockRow, batches = []) => {
  if ((!Array.isArray(batches) || batches.length === 0) && Number(stockRow?.batchCount || 0) <= 0) {
    return;
  }
  await prisma.stockBatch.deleteMany({ where: { stockId: stockRow.id } });
  for (const batch of Array.isArray(batches) ? batches : []) {
    await prisma.stockBatch.create({
      data: {
        id: String(batch.id || `batch-${stockRow.productId}-${batch.batchNo || Date.now()}-${Math.random().toString(16).slice(2)}`),
        tenantId: stockRow.tenantId || getActiveTenantId(),
        stockId: stockRow.id,
        productId: stockRow.productId,
        batchNo: String(batch.batchNo || ''),
        skt: batch.skt || null,
        warehouseQuantity: toInt(batch.warehouseQuantity) || 0,
        shelfQuantity: toInt(batch.shelfQuantity) || 0,
        totalQuantity: toInt(batch.totalQuantity) ?? ((toInt(batch.warehouseQuantity) || 0) + (toInt(batch.shelfQuantity) || 0)),
        status: batch.status || null,
        payload: toJson(batch),
      },
    });
  }
};

const createStockPostgresRepository = (client = null) => ({
  filePath: 'postgres://stock',
  ensureFile: async () => {},
  async readData() {
    return this.getAll();
  },
  async writeData(items) {
    const prisma = client || await getPrisma();
    await prisma.stockBatch.deleteMany({ where: tenantWhere('stockBatch') });
    await prisma.stock.deleteMany({ where: tenantWhere('stock') });
    const created = [];
    for (const item of Array.isArray(items) ? items : []) {
      created.push(await this.create(item));
    }
    return created;
  },
  async getAll() {
    const prisma = client || await getPrisma();
    const rows = await prisma.stock.findMany({ where: tenantWhere('stock'), include: { batches: true } });
    return rows.map(mapStockFromDb);
  },
  async findById(productId) {
    return this.findByProductId(productId);
  },
  async findByProductId(productId) {
    const prisma = client || await getPrisma();
    const row = await prisma.stock.findFirst({ where: tenantWhere('stock', { productId }), include: { batches: true } });
    return mapStockFromDb(row);
  },
  async findOne(predicate) {
    const all = await this.getAll();
    return all.find(predicate) || null;
  },
  async create(item) {
    const prisma = client || await getPrisma();
    const row = await prisma.stock.create({ data: stockData(item) });
    await syncStockBatches(prisma, row, item.batches || []);
    return this.findByProductId(row.productId);
  },
  async updateById(productId, updater) {
    const existing = await this.findByProductId(productId);
    if (!existing) return null;
    const nextValue = typeof updater === 'function' ? updater(existing) : updater;
    const prisma = client || await getPrisma();
    const row = await prisma.stock.update({
      where: { productId },
      data: stockData({ ...existing, ...nextValue, productId }),
    });
    await syncStockBatches(prisma, row, nextValue.batches || existing.batches || []);
    return this.findByProductId(productId);
  },
  async deleteById(productId) {
    const prisma = client || await getPrisma();
    const existing = await this.findByProductId(productId);
    if (!existing) return null;
    await prisma.stock.delete({ where: { productId } });
    return existing;
  },
});

const createSettingsPostgresRepository = (client = null) => ({
  filePath: 'postgres://settings',
  ensureFile: async () => {},
  async readData() {
    const prisma = client || await getPrisma();
    const tenantId = getActiveTenantId();
    const storeId = getActiveStoreId();
    const row = await prisma.setting.findFirst({ where: { tenantId, storeId } })
      || await prisma.setting.findFirst({ where: { tenantId, storeId: null } });
    const store = await prisma.store.findFirst({ where: { id: storeId, tenantId } });
    return {
      ...(isObject(row?.payload) ? clone(row.payload) : {}),
      ...(store?.name ? { storeName: store.name } : {}),
      ...(store?.code ? { branchCode: store.code } : {}),
    };
  },
  async writeData(payload) {
    const prisma = client || await getPrisma();
    const tenantId = getActiveTenantId();
    const storeId = getActiveStoreId();
    const id = `${tenantId}:${storeId}`;
    const data = {
      id,
      tenantId,
      storeId,
      systemName: payload?.systemName || null,
      companyName: payload?.companyName || payload?.businessName || 'Shelfio',
      currency: payload?.currency || null,
      timezone: payload?.timezone || null,
      updatedAt: toDate(payload?.updatedAt) || new Date(),
      payload: toJson(payload || {}),
    };
    await prisma.setting.upsert({
      where: { id },
      create: data,
      update: data,
    });
    await prisma.store.updateMany({
      where: { id: storeId, tenantId },
      data: {
        ...(payload?.storeName ? { name: payload.storeName } : {}),
        ...(payload?.branchCode ? { code: payload.branchCode } : {}),
      },
    });
    return payload;
  },
});

export const createPostgresRepository = ({ fileName, idKey = 'id', client = null }) => {
  if (fileName === 'settings.json') return createSettingsPostgresRepository(client);
  if (fileName === 'stocks.json') return createStockPostgresRepository(client);

  const modelName = MODEL_BY_FILE[fileName];
  if (!modelName) {
    throw new Error(`No PostgreSQL repository mapping for ${fileName}`);
  }

  if (['sale', 'purchaseOrder', 'task'].includes(modelName)) {
    return createNestedPostgresRepository({ modelName, client });
  }

  return createGenericPostgresRepository({ modelName, idKey, client });
};

export const postgresRepositoryModelNames = MODEL_BY_FILE;

