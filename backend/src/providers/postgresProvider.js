import { config } from '../config/config.js';

let prismaPromise = null;
let lastConnectionStatus = {
  checkedAt: null,
  ok: false,
  message: 'not_checked',
  database: config.databaseInfo.database || '',
  provider: config.databaseInfo.provider || 'postgresql',
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

      return new PrismaClient({
        adapter,
        log: config.prismaLogQueries ? ['query', 'warn', 'error'] : ['warn', 'error'],
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
