import { getshelfioControlClient } from '../services/getshelfioControlClient.js';
import { getLicenseControlPublicState } from '../services/licenseControlConfig.js';

export const licenseControlController = {
  async health(req, res) {
    try {
      const state = getLicenseControlPublicState();
      let controlApiReachable = null;
      let lastErrorCode;

      if (state.enabled && state.configured) {
        const result = await getshelfioControlClient.safeHealth();
        controlApiReachable = result.reachable === true;
        lastErrorCode = result.errorCode;
      }

      res.status(200).json({
        success: true,
        mode: state.mode,
        enabled: state.enabled,
        configured: state.configured,
        controlApiReachable,
        ...(lastErrorCode ? { lastErrorCode } : {}),
      });
    } catch {
      res.status(200).json({
        success: true,
        mode: 'off',
        enabled: false,
        configured: false,
        controlApiReachable: null,
        lastErrorCode: 'control_unreachable',
      });
    }
  },
};
