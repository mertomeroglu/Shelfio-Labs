import { grantService } from '../services/grantService.js';

const GRANT_EXPIRY_INTERVAL_MS = 60 * 1000;

export const startGrantExpiryJob = () => {
  const run = async () => {
    try {
      await grantService.expireTemporaryGrants();
    } catch (error) {
      console.error('[grant-expiry-job]', error?.message || error);
    }
  };

  run();
  return setInterval(run, GRANT_EXPIRY_INTERVAL_MS);
};
