import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { config } from './config/config.js';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler.js';
import { loggerMiddleware } from './middlewares/loggerMiddleware.js';
import { auditLogMiddleware } from './middlewares/auditLogMiddleware.js';
import { startGrantExpiryJob } from './jobs/grantExpiryJob.js';
import { startDailyClosingJob } from './jobs/dailyClosingJob.js';
import { startExpiredBatchNotificationJob } from './jobs/expiredBatchNotificationJob.js';
import { startExportCleanupJob } from './jobs/exportCleanupJob.js';
import { startPurchaseOrderLifecycleJob } from './jobs/purchaseOrderLifecycleJob.js';
import { startTemporaryPriceActionJob } from './jobs/temporaryPriceActionJob.js';
import routes from './routes/routes.js';
import { startTransferRequestAutomationJob } from './jobs/transferRequestAutomationJob.js';
import { securityMigrationService } from './services/securityMigrationService.js';
import { categoryLabelService } from './services/categoryLabelService.js';
import { getPostgresConnectionStatus, verifyPostgresConnection } from './providers/postgresProvider.js';
import { settingsService } from './services/settingsService.js';

const app = express();

const recordProcessDeveloperError = (error, action) => {
  const err = error instanceof Error ? error : new Error(String(error || 'Bilinmeyen process hatasi'));
  settingsService.recordDeveloperLog({
    level: 'error',
    source: 'backend',
    message: err.message,
    action,
    endpoint: 'process',
    requestUrl: 'process',
    stack: err.stack || '',
    errorType: action,
    description: 'Node.js process seviyesinde yakalandi.',
  }, null, {
    source: 'backend',
    action,
    endpoint: 'process',
  }).catch(() => {});
};

process.on('unhandledRejection', (reason) => {
  console.error('[process:unhandledRejection]', reason);
  recordProcessDeveloperError(reason, 'process.unhandledRejection');
});

process.on('uncaughtExceptionMonitor', (error) => {
  console.error('[process:uncaughtException]', error);
  recordProcessDeveloperError(error, 'process.uncaughtException');
});

const normalizeNfcDeep = (value) => {
  if (typeof value === 'string') {
    return value.normalize('NFC');
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeNfcDeep(item));
  }

  if (value && typeof value === 'object') {
    const normalized = {};
    Object.entries(value).forEach(([key, entry]) => {
      normalized[key] = normalizeNfcDeep(entry);
    });
    return normalized;
  }

  return value;
};

const logDataSourceStartup = (status = null) => {
  console.info('[data-source]', {
    dataStore: config.dataStore,
    requestedDataStore: config.requestedDataStore,
    dbProvider: config.databaseInfo.provider,
    dbHost: config.databaseInfo.host,
    dbPort: config.databaseInfo.port,
    dbName: config.databaseInfo.database,
    hasDatabaseUrl: config.databaseInfo.hasUrl,
    postgresConnected: Boolean(status?.ok),
    startupMaintenanceEnabled: Boolean(config.runStartupMaintenance),
  });
};

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: false,
}));
app.use(cors());
app.use((req, res, next) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});
app.use(express.json({ limit: '12mb' }));
app.use(express.urlencoded({ extended: true, limit: '12mb' }));
app.use((req, res, next) => {
  if (req.body && typeof req.body === 'object') {
    req.body = normalizeNfcDeep(req.body);
  }

  if (req.query && typeof req.query === 'object') {
    req.query = normalizeNfcDeep(req.query);
  }

  if (req.params && typeof req.params === 'object') {
    req.params = normalizeNfcDeep(req.params);
  }

  next();
});
app.use(loggerMiddleware);
app.use(auditLogMiddleware);

app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Shelfio API running',
  });
});

app.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'ok',
    dataSource: {
      dataStore: config.dataStore,
      dbProvider: config.databaseInfo.provider,
      postgres: getPostgresConnectionStatus(),
      startupMaintenanceEnabled: Boolean(config.runStartupMaintenance),
    },
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    data: {
      status: 'ok',
      timestamp: new Date().toISOString(),
      dataSource: {
        dataStore: config.dataStore,
        dbProvider: config.databaseInfo.provider,
        postgres: getPostgresConnectionStatus(),
        startupMaintenanceEnabled: Boolean(config.runStartupMaintenance),
      },
    },
  });
});

app.use('/api', routes);
app.use(notFoundHandler);
app.use(errorHandler);

const start = async () => {
  try {
    const postgresStatus = config.dataStore === 'postgres'
      ? await verifyPostgresConnection()
      : null;
    logDataSourceStartup(postgresStatus);
    const shouldRunStartupMaintenance = config.runStartupMaintenance === true;
    if (shouldRunStartupMaintenance) {
      startGrantExpiryJob();
    } else {
      console.info('Startup maintenance skipped by RUN_STARTUP_MAINTENANCE=false');
    }
    startDailyClosingJob();
    startPurchaseOrderLifecycleJob();
    startTemporaryPriceActionJob();
    startExpiredBatchNotificationJob();
    startTransferRequestAutomationJob();
    startExportCleanupJob();
    app.listen(config.port, () => {
      console.log(`Server running on port ${config.port}`);
    });

    if (config.dataStore === 'postgres' && shouldRunStartupMaintenance) {
      void securityMigrationService.apply().catch((error) => {
        console.error('Security migration failed', error);
      });

      void categoryLabelService.syncAuthoritative().catch((error) => {
        console.error('Category label sync failed', error);
      });
    }
  } catch (error) {
    console.error('Server baslatilamadi', error);
    process.exit(1);
  }
};

start();
