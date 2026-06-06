import { getshelfioControlClient } from '../services/getshelfioControlClient.js';
import { assertShelfioControlSecret } from '../services/internalControlAuth.js';
import { licenseControlExportService } from '../services/licenseControlExportService.js';
import { getLicenseControlPublicState } from '../services/licenseControlConfig.js';
import { licenseUsageService } from '../services/licenseUsageService.js';

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

  async tenantUsage(req, res, next) {
    try {
      const data = await licenseUsageService.getTenantUsage(
        req.params.externalTenantId,
        req.get('X-Shelfio-Control-Secret'),
      );
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async createExport(req, res, next) {
    try {
      assertShelfioControlSecret(req.get('X-Shelfio-Control-Secret'), {
        notConfiguredCode: 'export_secret_not_configured',
        unauthorizedCode: 'export_unauthorized',
        notConfiguredMessage: 'Export endpoint yapilandirilmamis.',
        unauthorizedMessage: 'Export endpoint erisimi reddedildi.',
      });
      const data = await licenseControlExportService.createExport(req.body || {});
      res.status(202).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async exportStatus(req, res, next) {
    try {
      assertShelfioControlSecret(req.get('X-Shelfio-Control-Secret'), {
        notConfiguredCode: 'export_secret_not_configured',
        unauthorizedCode: 'export_unauthorized',
        notConfiguredMessage: 'Export endpoint yapilandirilmamis.',
        unauthorizedMessage: 'Export endpoint erisimi reddedildi.',
      });
      const data = await licenseControlExportService.getStatus(req.params.jobId);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async downloadExport(req, res, next) {
    try {
      const data = await licenseControlExportService.downloadByToken(req.params.downloadToken);
      res.setHeader('Content-Type', data.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${data.fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}"`);
      res.send(data.buffer);
    } catch (error) {
      next(error);
    }
  },
};
