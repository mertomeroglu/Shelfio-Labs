import { AppError } from '../utils/appError.js';
import { authService } from '../services/authService.js';
import { getshelfioControlClient } from '../services/getshelfioControlClient.js';
import { isLicenseControlConfigured } from '../services/licenseControlConfig.js';
import {
  assertActiveSsoProvisioningContext,
  extractSsoProvisioningContext,
  ssoProvisioningService,
} from '../services/ssoProvisioningService.js';

const getRequestMeta = (req) => {
  const forwardedFor = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const userAgent = String(req.headers['user-agent'] || '');
  return {
    ipAddress: forwardedFor || req.ip || req.socket?.remoteAddress || '',
    userAgent,
    device: userAgent,
    requestId: req.requestId || req.headers['x-request-id'] || '',
    source: 'getshelfio_sso',
  };
};

const extractExchangeData = (result) => {
  const data = result?.data || {};
  return data?.data || data;
};

const extractSsoUser = (payload) =>
  payload?.user || payload?.account || payload?.customer || payload?.member || null;

const toControlAppError = (result) => {
  if (result?.errorCode === 'control_not_configured') {
    return new AppError(503, 'SSO bağlantısı şu anda yapılandırılmamış.', { errorCode: result.errorCode });
  }

  if (result?.errorCode === 'control_unauthorized') {
    return new AppError(502, 'SSO bağlantısı doğrulanamadı.', { errorCode: result.errorCode });
  }

  return new AppError(503, 'SSO bağlantısına şu anda ulaşılamıyor.', {
    errorCode: result?.errorCode || 'control_unreachable',
  });
};

const writeAuditSafely = (payload) => {
  void getshelfioControlClient.writeControlAudit(payload).catch(() => {});
};

export const ssoController = {
  async exchange(req, res, next) {
    const code = String(req.body?.code || '').trim();
    let auditPayload = {
      action: 'main_app_sso_exchange_failed',
      reason: 'unknown',
    };

    try {
      if (!code) {
        auditPayload.reason = 'missing_code';
        throw new AppError(400, 'SSO kodu doğrulanamadı.', { errorCode: 'sso_exchange_failed' });
      }

      if (!isLicenseControlConfigured()) {
        auditPayload.reason = 'control_not_configured';
        throw new AppError(503, 'SSO bağlantısı şu anda yapılandırılmamış.');
      }

      const exchangeResult = await getshelfioControlClient.exchangeSsoCode(code);
      if (!exchangeResult.ok) {
        auditPayload.reason = exchangeResult.errorCode;
        throw toControlAppError(exchangeResult);
      }

      const exchangeData = extractExchangeData(exchangeResult);
      const ssoUser = extractSsoUser(exchangeData);

      if (!ssoUser?.email && !ssoUser?.username) {
        auditPayload.reason = 'missing_user_email';
        throw new AppError(400, 'SSO kullanıcı bilgisi doğrulanamadı.', { errorCode: 'email_missing' });
      }

      const provisioningContext = assertActiveSsoProvisioningContext(extractSsoProvisioningContext(exchangeData));
      const provisionedLicense = await ssoProvisioningService.findProvisionedLicense(provisioningContext.externalLicenseId);

      if (provisionedLicense) {
        try {
          await ssoProvisioningService.syncLicenseData(provisioningContext.externalLicenseId, provisioningContext);
        } catch (syncError) {
          console.error('[SSO License Sync Error]', syncError);
        }
      }

      const tenantContext = provisionedLicense ? {
        tenantId: provisionedLicense.tenantId,
        licenseId: provisionedLicense.id,
      } : {};
      let session;
      try {
        session = await authService.loginWithSsoUser(ssoUser, getRequestMeta(req), exchangeData, tenantContext);
      } catch (error) {
        if (error?.errorCode !== 'sso_account_missing' || provisionedLicense) {
          throw error;
        }

        const setup = await ssoProvisioningService.createSetupChallenge({
          exchangeCode: code,
          context: provisioningContext,
        });
        writeAuditSafely({
          action: 'main_app_sso_setup_required',
          tenantId: provisioningContext.externalTenantId || '',
          licenseStatus: provisioningContext.status,
        });
        res.json({ success: true, data: setup });
        return;
      }
      auditPayload = {
        action: 'main_app_sso_exchange_success',
        email: ssoUser.email || ssoUser.username || '',
        tenantId: exchangeData?.tenant?.id || exchangeData?.tenantId || '',
        licenseStatus: session?.licenseSummary?.status || exchangeData?.license?.status || exchangeData?.licenseStatus || '',
      };
      writeAuditSafely(auditPayload);
      res.json({ success: true, data: session });
    } catch (error) {
      writeAuditSafely({
        ...auditPayload,
        statusCode: error?.statusCode || error?.status || 500,
        message: error?.message || 'SSO exchange failed',
      });
      next(error);
    }
  },

  async setup(req, res, next) {
    try {
      const provisioned = await ssoProvisioningService.setupTenantAdmin(req.body || {});
      const session = await authService.loginWithSsoUser(
        { email: provisioned.user.email },
        getRequestMeta(req),
        {},
        {
          tenantId: provisioned.tenantId,
          storeId: provisioned.storeId,
          licenseId: provisioned.licenseId,
        },
      );
      writeAuditSafely({
        action: 'main_app_sso_setup_completed',
        tenantId: provisioned.tenantId,
      });
      res.status(201).json({ success: true, data: session });
    } catch (error) {
      next(error);
    }
  },
};
