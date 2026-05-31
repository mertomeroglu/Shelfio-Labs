import { AppError } from '../utils/appError.js';
import { authService } from '../services/authService.js';
import { getshelfioControlClient } from '../services/getshelfioControlClient.js';
import { isLicenseControlConfigured } from '../services/licenseControlConfig.js';

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
        throw new AppError(400, 'SSO kodu doğrulanamadı.');
      }

      if (!isLicenseControlConfigured()) {
        auditPayload.reason = 'control_not_configured';
        throw new AppError(503, 'SSO bağlantısı şu anda yapılandırılmamış.');
      }

      const exchangeResult = await getshelfioControlClient.exchangeSsoCode(code);
      const exchangeData = extractExchangeData(exchangeResult);
      const ssoUser = extractSsoUser(exchangeData);

      if (!ssoUser?.email && !ssoUser?.username) {
        auditPayload.reason = 'missing_user_email';
        throw new AppError(400, 'SSO kullanıcı bilgisi doğrulanamadı.');
      }

      const session = await authService.loginWithSsoUser(ssoUser, getRequestMeta(req), exchangeData);
      auditPayload = {
        action: 'main_app_sso_exchange_success',
        email: ssoUser.email || ssoUser.username || '',
        tenantId: exchangeData?.tenant?.id || exchangeData?.tenantId || '',
        licenseStatus: exchangeData?.license?.status || exchangeData?.licenseStatus || '',
      };
      void getshelfioControlClient.writeControlAudit(auditPayload);
      res.json({ success: true, data: session });
    } catch (error) {
      void getshelfioControlClient.writeControlAudit({
        ...auditPayload,
        statusCode: error?.statusCode || error?.status || 500,
        message: error?.message || 'SSO exchange failed',
      });
      next(error);
    }
  },
};
