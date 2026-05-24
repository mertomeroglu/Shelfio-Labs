import { procurementService } from '../services/procurementService.js';

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
let lifecycleInterval = null;
let running = false;

const runLifecycleTick = async (source = 'scheduler') => {
  if (running) return { skipped: true, reason: 'already_running' };
  running = true;
  try {
    const result = await procurementService.progressDuePurchaseOrders({ limit: 500 });
    if (result.progressedCount > 0) {
      console.info('[purchase-order-lifecycle]', { source, ...result });
    }
    return result;
  } catch (error) {
    console.error('[purchase-order-lifecycle] failed', error);
    return { error: error?.message || String(error) };
  } finally {
    running = false;
  }
};

export const startPurchaseOrderLifecycleJob = ({ intervalMs = DEFAULT_INTERVAL_MS } = {}) => {
  if (lifecycleInterval) return lifecycleInterval;

  void runLifecycleTick('startup');
  lifecycleInterval = setInterval(() => {
    void runLifecycleTick('scheduler');
  }, Math.max(60_000, Number(intervalMs) || DEFAULT_INTERVAL_MS));

  if (typeof lifecycleInterval.unref === 'function') {
    lifecycleInterval.unref();
  }

  return lifecycleInterval;
};

export const __purchaseOrderLifecycleJobInternals = {
  runLifecycleTick,
};
