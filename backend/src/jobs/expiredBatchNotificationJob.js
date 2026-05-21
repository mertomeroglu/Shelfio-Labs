import { expiredBatchNotificationService } from '../services/expiredBatchNotificationService.js';

const DAY_MS = 24 * 60 * 60 * 1000;

let timer = null;
let running = false;

const scheduleNextRun = () => {
  const now = new Date();
  const next = new Date(now);
  next.setHours(0, 10, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  const delay = Math.min(Math.max(1000, next.getTime() - now.getTime()), DAY_MS);
  timer = setTimeout(async () => {
    await runExpiredBatchNotificationJob();
  }, delay);
  timer.unref?.();
};

export const runExpiredBatchNotificationJob = async () => {
  if (running) return null;
  running = true;
  try {
    const result = await expiredBatchNotificationService.run({ dryRun: false });
    if (result?.createdCount > 0) {
      console.info('[expired-batch-notification-job]', {
        createdCount: result.createdCount,
        totalExpiredBatches: result.totalExpiredBatches,
      });
    }
    return result;
  } catch (error) {
    console.error('[expired-batch-notification-job] failed', error?.message || error);
    return null;
  } finally {
    running = false;
    scheduleNextRun();
  }
};

export const startExpiredBatchNotificationJob = () => {
  if (timer) return;
  void runExpiredBatchNotificationJob();
};
