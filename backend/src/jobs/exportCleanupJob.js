import { licenseControlExportService } from '../services/licenseControlExportService.js';

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
let timer = null;
let running = false;

export const runExportCleanupJob = async () => {
  if (running) return null;
  running = true;
  try {
    return await licenseControlExportService.cleanupExpiredExports();
  } catch (error) {
    console.error('[export-cleanup-job] failed', error);
    return null;
  } finally {
    running = false;
  }
};

export const startExportCleanupJob = () => {
  if (timer) return;
  void runExportCleanupJob();
  timer = setInterval(() => {
    void runExportCleanupJob();
  }, CLEANUP_INTERVAL_MS);
  timer.unref?.();
};
