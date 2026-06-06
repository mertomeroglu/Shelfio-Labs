import { config } from '../config/config.js';

const DEFAULT_SLOW_QUERY_MS = 250;

const getSlowQueryThresholdMs = () => {
  const configured = Number(process.env.SLOW_QUERY_MS || DEFAULT_SLOW_QUERY_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_SLOW_QUERY_MS;
};

export const withPostgresQueryLogging = async (label, operation) => {
  const start = process.hrtime.bigint();
  try {
    const result = await operation();
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    if (config.dataStore === 'postgres' && durationMs >= getSlowQueryThresholdMs()) {
      console.warn('[postgres:slow-query]', {
        label,
        durationMs: Number(durationMs.toFixed(1)),
        thresholdMs: getSlowQueryThresholdMs(),
      });
    }
    return result;
  } catch (error) {
    const durationMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    if (config.dataStore === 'postgres') {
      console.error('[postgres:query-error]', {
        label,
        durationMs: Number(durationMs.toFixed(1)),
        message: error?.message,
        code: error?.code,
      });
    }
    throw error;
  }
};
