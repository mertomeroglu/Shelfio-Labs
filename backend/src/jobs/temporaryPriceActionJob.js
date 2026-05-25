import { pricingAnalysisService } from '../services/analysis/pricingAnalysisService.js';

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
let temporaryPriceActionInterval = null;
let running = false;

const runTemporaryPriceActionTick = async (source = 'scheduler') => {
  if (running) return { skipped: true, reason: 'already_running' };
  running = true;
  try {
    const result = await pricingAnalysisService.expireTemporaryPriceActions({
      limit: 250,
      actor: { id: 'system', name: 'Sistem' },
    });
    if (result.expiredCount > 0) {
      console.info('[temporary-price-actions]', { source, ...result });
    }
    return result;
  } catch (error) {
    console.error('[temporary-price-actions] failed', error?.message || error);
    return { error: error?.message || String(error) };
  } finally {
    running = false;
  }
};

export const startTemporaryPriceActionJob = ({ intervalMs = DEFAULT_INTERVAL_MS } = {}) => {
  if (temporaryPriceActionInterval) return temporaryPriceActionInterval;

  void runTemporaryPriceActionTick('startup');
  temporaryPriceActionInterval = setInterval(() => {
    void runTemporaryPriceActionTick('scheduler');
  }, Math.max(60_000, Number(intervalMs) || DEFAULT_INTERVAL_MS));

  if (typeof temporaryPriceActionInterval.unref === 'function') {
    temporaryPriceActionInterval.unref();
  }

  return temporaryPriceActionInterval;
};

export const __temporaryPriceActionJobInternals = {
  runTemporaryPriceActionTick,
};
