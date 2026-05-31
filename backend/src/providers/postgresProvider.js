import { config } from '../config/config.js';
import { getActiveTenantId, isTenantScopedRequest, MAIN_TENANT_ID } from '../tenant/tenantContext.js';

let prismaPromise = null;
let lastConnectionStatus = {
  checkedAt: null,
  ok: false,
  message: 'not_checked',
  database: config.databaseInfo.database || '',
  provider: config.databaseInfo.provider || 'postgresql',
};

const TENANT_SCOPED_PRISMA_MODELS = new Set([
  'AccessAuditLog',
  'AccessRequest',
  'AuditLog',
  'BeaconDevice',
  'CatalogImport',
  'Category',
  'Customer',
  'CustomerOrder',
  'CustomerPasswordResetToken',
  'DailyStoreClosing',
  'EslDevice',
  'EslHistory',
  'LocationZone',
  'LoginActivityLog',
  'Notification',
  'NotificationDelivery',
  'NotificationRule',
  'Product',
  'ProductPriceEvent',
  'ProximityEvent',
  'PurchaseOrder',
  'PurchaseOrderActivityLog',
  'PurchaseOrderItem',
  'PurchaseOrderStatusHistory',
  'PurchaseSuggestion',
  'Sale',
  'SaleItem',
  'Section',
  'Setting',
  'Stock',
  'StockBatch',
  'StockMovement',
  'StockTransferRequest',
  'Supplier',
  'SupplierCatalogVersion',
  'SupplierProduct',
  'SupportTicket',
  'Task',
  'TaskComment',
  'TemporaryPermissionGrant',
  'TemporaryPriceAction',
  'TransferAudit',
  'User',
  'WarehouseLocation',
  'WarehouseMovement',
]);

const READ_OPERATIONS = new Set(['findFirst', 'findMany', 'count', 'aggregate', 'groupBy']);
const WRITE_MANY_OPERATIONS = new Set(['updateMany', 'deleteMany']);
const CREATE_OPERATIONS = new Set(['create', 'createMany']);

const mergeTenantWhere = (where, tenantId) => {
  if (!where || Object.keys(where).length === 0) return { tenantId };
  if (where.tenantId) return where;
  return { AND: [where, { tenantId }] };
};

const addTenantToData = (data, tenantId) => {
  if (Array.isArray(data)) {
    return data.map((item) => ({ ...item, tenantId: item?.tenantId || tenantId }));
  }
  if (!data || typeof data !== 'object') return data;
  return { ...data, tenantId: data.tenantId || tenantId };
};

export const isPostgresEnabled = () => config.dataStore === 'postgres';

export const getPrisma = async () => {
  if (!isPostgresEnabled()) {
    throw new Error('PostgreSQL data store is not enabled');
  }

  if (!prismaPromise) {
    prismaPromise = Promise.all([
      import('@prisma/client'),
      import('@prisma/adapter-pg'),
    ]).then(([{ PrismaClient }, { PrismaPg }]) => {
      const adapter = new PrismaPg({
        connectionString: config.databaseUrl || process.env.DATABASE_URL,
      });

      const prisma = new PrismaClient({
        adapter,
        log: config.prismaLogQueries ? ['query', 'warn', 'error'] : ['warn', 'error'],
      });

      return prisma.$extends({
        query: {
          $allModels: {
            async $allOperations({ model, operation, args, query }) {
              if (!TENANT_SCOPED_PRISMA_MODELS.has(model)) {
                return query(args);
              }

              const tenantId = isTenantScopedRequest() ? getActiveTenantId() : MAIN_TENANT_ID;
              const nextArgs = { ...(args || {}) };

              if (READ_OPERATIONS.has(operation) || WRITE_MANY_OPERATIONS.has(operation)) {
                nextArgs.where = mergeTenantWhere(nextArgs.where, tenantId);
              }

              if (CREATE_OPERATIONS.has(operation)) {
                nextArgs.data = addTenantToData(nextArgs.data, tenantId);
              }

              return query(nextArgs);
            },
          },
        },
      });
    });
  }

  return prismaPromise;
};

const formatConnectionError = (error) => ({
  ok: false,
  message: error?.message || String(error),
  code: error?.code || error?.cause?.code || '',
  provider: config.databaseInfo.provider || 'postgresql',
  database: config.databaseInfo.database || '',
});

export const verifyPostgresConnection = async () => {
  if (!isPostgresEnabled()) {
    lastConnectionStatus = {
      checkedAt: new Date().toISOString(),
      ok: false,
      message: 'postgres_disabled',
      provider: config.databaseInfo.provider || 'postgresql',
      database: config.databaseInfo.database || '',
    };
    return lastConnectionStatus;
  }

  if (!config.databaseUrl) {
    const error = new Error('DATABASE_URL is required when DATA_STORE=postgres');
    lastConnectionStatus = {
      checkedAt: new Date().toISOString(),
      ...formatConnectionError(error),
    };
    throw error;
  }

  try {
    const prisma = await getPrisma();
    const rows = await prisma.$queryRaw`SELECT current_database() AS database, current_schema() AS schema`;
    const first = Array.isArray(rows) ? rows[0] : null;
    lastConnectionStatus = {
      checkedAt: new Date().toISOString(),
      ok: true,
      message: 'connected',
      provider: config.databaseInfo.provider || 'postgresql',
      database: first?.database || config.databaseInfo.database || '',
      schema: first?.schema || 'public',
    };
    return lastConnectionStatus;
  } catch (error) {
    lastConnectionStatus = {
      checkedAt: new Date().toISOString(),
      ...formatConnectionError(error),
    };
    throw error;
  }
};

export const getPostgresConnectionStatus = () => ({ ...lastConnectionStatus });

export const disconnectPrisma = async () => {
  if (!prismaPromise) return;
  const prisma = await prismaPromise;
  await prisma.$disconnect();
  prismaPromise = null;
};
