import { getshelfioControlClient } from '../services/getshelfioControlClient.js';
import { getLicenseControlPublicState } from '../services/licenseControlConfig.js';

export const licenseControlController = {
  async health(req, res, next) {
    try {
      const state = getLicenseControlPublicState();
      let controlApiReachable = null;

      if (state.enabled && state.configured) {
        const result = await getshelfioControlClient.safeHealth();
        controlApiReachable = Boolean(result.success && result.reachable);
      }

      res.json({
        success: true,
        mode: state.mode,
        enabled: state.enabled,
        configured: state.configured,
        controlApiReachable,
      });
    } catch (error) {
      next(error);
    }
  },
};
