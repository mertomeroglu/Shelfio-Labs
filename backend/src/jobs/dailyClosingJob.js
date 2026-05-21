import { settingsRepo } from '../repositories/settingsRepository.js';
import { dailyClosingService } from '../services/dailyClosingService.js';

let timer = null;
let running = false;

const scheduleNextRun = async () => {
  const settings = await settingsRepo.getSettings();
  const delay = Math.min(
    dailyClosingService.getNextLocalMidnightDelay(settings, new Date()),
    dailyClosingService.getMaxTimerDelay(),
  );

  timer = setTimeout(async () => {
    await runDailyClosingJob();
  }, delay);
  timer.unref?.();
};

export const runDailyClosingJob = async () => {
  if (running) return null;
  running = true;
  try {
    const closed = await dailyClosingService.closePreviousBusinessDate({ source: 'scheduler' });
    await dailyClosingService.ensureRecentClosings(7, { source: 'scheduler-catchup' });
    return closed;
  } catch (error) {
    console.error('[daily-closing-job] failed', error);
    return null;
  } finally {
    running = false;
    await scheduleNextRun().catch((error) => {
      console.error('[daily-closing-job] reschedule failed', error);
    });
  }
};

export const startDailyClosingJob = () => {
  if (timer) return;
  void dailyClosingService.ensureRecentClosings(7, { source: 'startup-backfill' }).catch((error) => {
    console.error('[daily-closing-job] startup backfill failed', error);
  });
  void scheduleNextRun().catch((error) => {
    console.error('[daily-closing-job] schedule failed', error);
  });
};
