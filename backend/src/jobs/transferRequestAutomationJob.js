import { sectionService } from '../services/sectionService.js';

const DEFAULT_INTERVAL_MINUTES = 30;
let timer = null;
let running = false;

const runOnce = async () => {
  if (running) return;
  running = true;
  try {
    const result = await sectionService.runTransferAutomationScan();
    if (result.createdCount > 0) {
      console.info('[transfer-automation]', {
        createdCount: result.createdCount,
        skippedCount: result.skippedCount,
      });
    }
  } catch (error) {
    console.error('[transfer-automation] scan failed', error);
  } finally {
    running = false;
  }
};

export const startTransferRequestAutomationJob = () => {
  if (timer) return timer;

  const enabled = process.env.REPLENISHMENT_SCAN_ENABLED !== 'false';
  if (!enabled) {
    console.info('[transfer-automation] scheduler is disabled via REPLENISHMENT_SCAN_ENABLED');
    return null;
  }

  const intervalMinutes = Number(process.env.REPLENISHMENT_SCAN_INTERVAL_MINUTES || DEFAULT_INTERVAL_MINUTES);
  const intervalMs = Math.max(60_000, intervalMinutes * 60 * 1000);

  const isDev = process.env.NODE_ENV === 'development';
  if (!isDev) {
    // Run initial scan in production after 15 seconds
    setTimeout(runOnce, 15_000);
  } else {
    console.info('[transfer-automation] Running in development mode. Skipping immediate startup scan to prevent unnecessary runs.');
  }

  timer = setInterval(runOnce, intervalMs);
  console.info(`[transfer-automation] scheduler started with interval of ${intervalMinutes} minutes.`);
  return timer;
};

