import { sectionService } from '../services/sectionService.js';

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
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
  const intervalMs = Math.max(60_000, Number(process.env.TRANSFER_AUTOMATION_INTERVAL_MS || DEFAULT_INTERVAL_MS));
  setTimeout(runOnce, 15_000);
  timer = setInterval(runOnce, intervalMs);
  return timer;
};
