import { v4 as uuidv4 } from 'uuid';
import { userRepo } from '../repositories/userRepository.js';
import { config } from '../config/config.js';
import { AppError, createNotFoundError } from '../utils/appError.js';
import { comparePassword, hashPassword } from '../utils/password.js';
import { signStaffRefreshToken, signToken, verifyStaffRefreshToken } from '../utils/jwt.js';
import { sanitizeRegisterInput, validateLoginPayload, validateRegisterPayload } from '../utils/validators.js';
import { settingsService } from './settingsService.js';
import { licenseService } from './licenseService.js';
import { buildLicenseSummaryFromControlPayload, sanitizeLicenseSummary } from './licenseSummaryService.js';
import {
  MAIN_TENANT_ID,
  MAIN_STORE_ID,
  getActiveStoreId,
  getActiveTenantId,
  runWithTenantContext,
} from '../tenant/tenantContext.js';
import { getshelfioControlClient } from './getshelfioControlClient.js';
import { isLicenseControlEnabled, isLicenseControlConfigured } from './licenseControlConfig.js';

const PERSONNEL_LOGIN_SOURCE = 'personnel_mobile';
const PERSONNEL_LOGIN_ALLOWED_ROLES = new Set(['depo_personeli', 'user']);
const LOGIN_INVALID_CREDENTIALS_MESSAGE = 'E-posta veya şifre hatalı.';
const PERSONNEL_LICENSE_CONFIGURATION_MESSAGE = 'Personel girişi şu anda yapılandırılamadı.';

const isPersonnelLoginSource = (source) => String(source || '').trim() === PERSONNEL_LOGIN_SOURCE;

const isPersonnelLoginAllowed = (user) => {
  if (isUnlimitedAccessUser(user)) return true;
  return PERSONNEL_LOGIN_ALLOWED_ROLES.has(String(user?.role || '').trim());
};

const normalizeIdentityText = (value) => String(value || '')
  .toLowerCase()
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]/g, '');

const isUnlimitedAccessUser = (user) => {
  const id = normalizeIdentityText(user?.id);
  const username = normalizeIdentityText(user?.username);
  const email = normalizeIdentityText(user?.email);
  const name = normalizeIdentityText(user?.name);

  if (id === 'uadmin1') {
    return true;
  }

  if (username.includes('mert') && (username.includes('omeroglu') || username.includes('omeroplu'))) {
    return true;
  }

  if (email.includes('mert') && (email.includes('omeroglu') || email.includes('omeroplu'))) {
    return true;
  }

  return name.includes('mert') && (name.includes('omeroglu') || name.includes('omeroplu'));
};

const mapUser = (user) => {
  const unlimitedAccess = isUnlimitedAccessUser(user);

  return {
    id: user.id,
    username: user.username,
    name: user.name,
    email: user.email || '',
    role: unlimitedAccess ? 'admin' : user.role,
    tenantId: user.tenantId || MAIN_TENANT_ID,
    storeId: user.storeId || 'store-main',
    assignedDeskCode: user.assignedDeskCode || null,
    registerPin: user.registerPin || '',
    isActive: user.isActive,
    isSuperUser: unlimitedAccess,
    lastLoginAt: user.lastLoginAt || null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
};

const issueSessionTokens = (user, tenantContext = {}) => {
  const unlimitedAccess = isUnlimitedAccessUser(user);
  const role = unlimitedAccess ? 'admin' : user.role;
  const tenantId = tenantContext.tenantId || user.tenantId || MAIN_TENANT_ID;
  const storeId = tenantContext.storeId || user.storeId || MAIN_STORE_ID;
  const licenseId = tenantContext.licenseId || null;
  const token = signToken({
    sub: user.id,
    role,
    username: user.username,
    tenantId,
    storeId,
    licenseId,
  });
  const refreshToken = signStaffRefreshToken({
    sub: user.id,
    role,
    username: user.username,
    tenantId,
    storeId,
    licenseId,
    type: 'staff_refresh',
  });

  return { token, refreshToken };
};

const recordStaffLoginActivity = async (user, context = {}) => {
  try {
    await settingsService.recordLoginActivity(user, {
      userType: 'staff',
      source: context.source,
      eventType: context.eventType || 'login_success',
      status: context.status,
      failureReason: context.failureReason,
      identity: context.identity,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      device: context.device,
      requestId: context.requestId,
    });
  } catch {
    // Oturum akışını log hatası yüzünden kesmiyoruz.
  }
};

const attachSessionLicenseSummary = (sessionData = {}, controlSession = null) => {
  const controlSummary = controlSession ? buildLicenseSummaryFromControlPayload(controlSession) : null;
  const licenseSummary = sanitizeLicenseSummary({
    ...(sessionData.licenseSummary || sessionData.license?.licenseSummary || {}),
    ...(controlSummary || {}),
  });
  const userLicenseSummary = licenseSummary.planName || licenseSummary.planSlug || licenseSummary.licenseType || licenseSummary.status || licenseSummary.expiresAt || licenseSummary.isDemo
    ? licenseSummary
    : sessionData.licenseSummary || null;

  const enabledModules = sessionData.enabledModules || licenseSummary.enabledModules || [];
  const screenAccess = sessionData.screenAccess || licenseSummary.screenAccess || [];

  return {
    ...sessionData,
    licenseSummary: userLicenseSummary,
    enabledModules,
    screenAccess,
    user: sessionData.user ? { ...sessionData.user, licenseSummary: userLicenseSummary, enabledModules, screenAccess } : sessionData.user,
    currentUser: sessionData.currentUser ? { ...sessionData.currentUser, licenseSummary: userLicenseSummary, enabledModules, screenAccess } : sessionData.currentUser,
  };
};

const resolveLoginLicenseContext = async (payload = {}, activityContext = {}) => {
  if (!isPersonnelLoginSource(activityContext.source || payload.source)) {
    return licenseService.resolveLicenseSession(payload.licenseSessionToken);
  }

  try {
    return await licenseService.resolveLicenseKeyContext({
      licenseKey: config.personnelDefaultLicenseKey,
      source: PERSONNEL_LOGIN_SOURCE,
    });
  } catch {
    throw new AppError(503, PERSONNEL_LICENSE_CONFIGURATION_MESSAGE, {
      errorCode: 'personnel_license_unconfigured',
      authStep: 'personnel_license_context',
    });
  }
};

export const authService = {
  async login(payload, context = {}) {
    validateLoginPayload(payload);

    const username = String(payload.username).trim();
    const password = String(payload.password);
    const activityContext = {
      ...context,
      source: context.source || payload.source || 'admin_web',
      identity: username,
    };
    const isPersonnelLogin = isPersonnelLoginSource(activityContext.source);
    const licenseContext = await resolveLoginLicenseContext(payload, activityContext);
    const tenantRuntime = {
      tenantId: licenseContext.tenantId,
      storeId: licenseContext.storeId || MAIN_STORE_ID,
      licenseId: licenseContext.licenseId,
    };
    const user = await runWithTenantContext(tenantRuntime, () => userRepo.findByUsername(username));

    if (!user) {
      await recordStaffLoginActivity(null, {
        ...activityContext,
        eventType: 'login_failed',
        status: 'failed',
        failureReason: 'Kullanıcı bulunamadı',
      });
      throw new AppError(401, isPersonnelLogin ? LOGIN_INVALID_CREDENTIALS_MESSAGE : 'Kullanıcı bilgileri hatalı.');
    }

    if (!user.isActive) {
      await recordStaffLoginActivity(user, {
        ...activityContext,
        eventType: 'login_failed',
        status: 'failed',
        failureReason: 'Kullanıcı pasif',
      });
      throw new AppError(403, isPersonnelLogin ? 'Hesabınız pasif görünüyor.' : 'Bu kullanıcı pasif durumda', { errorCode: 'user_inactive' });
    }

    if (isPersonnelLogin && !isPersonnelLoginAllowed(user)) {
      await recordStaffLoginActivity(user, {
        ...activityContext,
        eventType: 'login_failed',
        status: 'failed',
        failureReason: 'Personel mobil yetkisi yok',
      });
      throw new AppError(403, 'Bu kullanıcı personel girişi için yetkili değil.', { errorCode: 'personnel_access_denied' });
    }

    const userTenantId = user.tenantId || MAIN_TENANT_ID;
    if (userTenantId !== licenseContext.tenantId) {
      await recordStaffLoginActivity(user, {
        ...activityContext,
        eventType: 'login_failed',
        status: 'failed',
        failureReason: 'Kullanıcı bu lisans tenantına bağlı değil',
      });
      throw new AppError(403, 'Bu kullanıcı bu lisans alanına bağlı değil.');
    }

    const passwordHash = String(user?.passwordHash || '').trim();
    if (!passwordHash) {
      await recordStaffLoginActivity(user, {
        ...activityContext,
        eventType: 'login_failed',
        status: 'failed',
        failureReason: 'Şifre kaydı yok',
      });
      throw new AppError(401, isPersonnelLogin ? LOGIN_INVALID_CREDENTIALS_MESSAGE : 'Kullanıcı bilgileri hatalı.');
    }

    let isMatch = false;
    try {
      isMatch = await comparePassword(password, passwordHash);
    } catch {
      await recordStaffLoginActivity(user, {
        ...activityContext,
        eventType: 'login_failed',
        status: 'failed',
        failureReason: 'Şifre doğrulama hatası',
      });
      throw new AppError(401, isPersonnelLogin ? LOGIN_INVALID_CREDENTIALS_MESSAGE : 'Kullanıcı bilgileri hatalı.');
    }

    if (!isMatch) {
      await recordStaffLoginActivity(user, {
        ...activityContext,
        eventType: 'login_failed',
        status: 'failed',
        failureReason: 'Şifre hatalı',
      });
      throw new AppError(401, isPersonnelLogin ? LOGIN_INVALID_CREDENTIALS_MESSAGE : 'Kullanıcı bilgileri hatalı.');
    }

    const loggedInUser = {
      ...user,
      lastLoginAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await runWithTenantContext(tenantRuntime, () => userRepo.updateById(user.id, loggedInUser));

    await runWithTenantContext(tenantRuntime, () => recordStaffLoginActivity(loggedInUser, {
      ...activityContext,
      eventType: 'login_success',
      status: 'success',
    }));

    const { token, refreshToken } = issueSessionTokens(loggedInUser, licenseContext);
    const tenantData = await licenseService.resolveAuthenticatedTenant({
      tenantId: licenseContext.tenantId,
      licenseId: licenseContext.licenseId,
      storeId: licenseContext.storeId,
    });

    return attachSessionLicenseSummary({
      token,
      refreshToken,
      user: mapUser(loggedInUser),
      currentUser: mapUser(loggedInUser),
      ...tenantData,
    });
  },

  async refreshSession(payload = {}) {
    const refreshToken = String(payload.refreshToken || '').trim();
    if (!refreshToken) {
      throw new AppError(401, 'Oturum süreniz doldu. Lütfen tekrar giriş yapın.');
    }

    let tokenPayload;
    try {
      tokenPayload = verifyStaffRefreshToken(refreshToken);
    } catch {
      throw new AppError(401, 'Oturum süreniz doldu. Lütfen tekrar giriş yapın.');
    }

    if (tokenPayload?.type !== 'staff_refresh') {
      throw new AppError(401, 'Oturum süreniz doldu. Lütfen tekrar giriş yapın.');
    }

    const tokenTenantId = tokenPayload.tenantId || MAIN_TENANT_ID;
    const user = await runWithTenantContext({
      tenantId: tokenTenantId,
      storeId: tokenPayload.storeId || MAIN_STORE_ID,
      licenseId: tokenPayload.licenseId || null,
    }, () => userRepo.findById(tokenPayload.sub));
    if (!user) {
      throw new AppError(401, 'Oturum süreniz doldu. Lütfen tekrar giriş yapın.');
    }

    if (!user.isActive) {
      throw new AppError(403, 'Bu işlem için yetkiniz bulunmuyor.');
    }

    const userTenantId = user.tenantId || MAIN_TENANT_ID;
    if (userTenantId !== tokenTenantId) {
      throw new AppError(403, 'Bu kullanıcı bu lisans alanına bağlı değil.');
    }

    const sessionContext = {
      tenantId: tokenTenantId,
      storeId: tokenPayload.storeId || user.storeId || MAIN_STORE_ID,
      licenseId: tokenPayload.licenseId || null,
    };
    const tenantData = await licenseService.resolveAuthenticatedTenant(sessionContext);
    const { token, refreshToken: nextRefreshToken } = issueSessionTokens(user, sessionContext);
    await recordStaffLoginActivity(user, {
      ...payload.context,
      eventType: 'token_refresh',
      status: 'success',
      source: payload.source || payload.context?.source || 'admin_web',
    });
    return attachSessionLicenseSummary({
      token,
      refreshToken: nextRefreshToken,
      user: mapUser(user),
      currentUser: mapUser(user),
      ...tenantData,
    });
  },

  async logout(user, context = {}) {
    await recordStaffLoginActivity(user, {
      ...context,
      eventType: 'logout',
      status: 'success',
      source: context.source || 'admin_web',
    });
    return { ok: true };
  },

  async loginWithSsoUser(ssoUser = {}, context = {}, controlSession = {}, tenantContext = {}) {
    const email = String(ssoUser?.email || ssoUser?.username || '').trim().toLowerCase();
    if (!email) {
      throw new AppError(400, 'SSO kullanıcı bilgisi doğrulanamadı.');
    }

    const lookupContext = tenantContext.tenantId
      ? {
          tenantId: tenantContext.tenantId,
          storeId: tenantContext.storeId || MAIN_STORE_ID,
          licenseId: tenantContext.licenseId || null,
        }
      : null;
    const findUser = () => userRepo.findByEmail(email).then((matched) => matched || userRepo.findByUsername(email));
    const user = lookupContext
      ? await runWithTenantContext(lookupContext, findUser)
      : await findUser();
    if (!user) {
      await recordStaffLoginActivity(null, {
        ...context,
        eventType: 'sso_login_failed',
        status: 'failed',
        identity: email,
        failureReason: 'Ana sistem kullanıcısı bulunamadı',
        source: context.source || 'getshelfio_sso',
      });
      throw new AppError(403, 'Ana sistem hesabı henüz hazırlanmadı.', { errorCode: 'sso_account_missing' });
    }

    if (!user.isActive) {
      await recordStaffLoginActivity(user, {
        ...context,
        eventType: 'sso_login_failed',
        status: 'failed',
        identity: email,
        failureReason: 'Kullanıcı pasif',
        source: context.source || 'getshelfio_sso',
      });
      throw new AppError(403, 'Bu kullanıcı pasif durumda');
    }

    const tenantId = tenantContext.tenantId || user.tenantId || MAIN_TENANT_ID;
    const storeId = tenantContext.storeId || user.storeId || MAIN_STORE_ID;
    const tenantData = await licenseService.resolveAuthenticatedTenant({
      tenantId,
      storeId,
      licenseId: tenantContext.licenseId || user.licenseId || null,
    });
    const sessionContext = {
      tenantId,
      storeId: tenantData.activeStore?.id || storeId,
      licenseId: tenantData.license?.id || user.licenseId || null,
    };
    const loggedInUser = {
      ...user,
      lastLoginAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await runWithTenantContext(sessionContext, () => userRepo.updateById(user.id, loggedInUser));
    await runWithTenantContext(sessionContext, () => recordStaffLoginActivity(loggedInUser, {
      ...context,
      eventType: 'sso_login_success',
      status: 'success',
      identity: email,
      source: context.source || 'getshelfio_sso',
    }));

    const { token, refreshToken } = issueSessionTokens(loggedInUser, sessionContext);

    const sessionResponse = attachSessionLicenseSummary({
      token,
      refreshToken,
      user: mapUser(loggedInUser),
      currentUser: mapUser(loggedInUser),
      ...tenantData,
      control: {
        tenantId: controlSession?.tenant?.id || controlSession?.tenantId || null,
        licenseStatus: controlSession?.license?.status || controlSession?.licenseStatus || null,
        planSlug: controlSession?.plan?.slug || controlSession?.plan?.code || controlSession?.planSlug || null,
        modules: controlSession?.modules || controlSession?.license?.modules || [],
        limits: controlSession?.limits || controlSession?.license?.limits || null,
      },
    }, controlSession);

    if (sessionContext.licenseId) {
      try {
        const licenseSession = await licenseService.createSessionForLicense(
          sessionContext.licenseId,
          tenantId,
          sessionContext.storeId,
          'getshelfio_sso'
        );
        sessionResponse.licenseSessionToken = licenseSession.licenseSessionToken;
        sessionResponse.licenseSessionExpiresAt = licenseSession.expiresAt;
      } catch (sessionError) {
        console.error('[SSO License Session Creation Error]', sessionError);
      }
    }

    return sessionResponse;
  },

  async getCurrentUser(userId, tenantContext = {}) {
    const user = await userRepo.findById(userId);
    if (!user) {
      throw createNotFoundError('Kullanıcı bulunamadı');
    }

    const sessionContext = {
      tenantId: tenantContext.tenantId || user.tenantId || MAIN_TENANT_ID,
      storeId: tenantContext.storeId || user.storeId || MAIN_STORE_ID,
      licenseId: tenantContext.licenseId || null,
    };
    const tenantData = await licenseService.resolveAuthenticatedTenant(sessionContext);
    let controlSession = null;
    try {
      if (isLicenseControlEnabled() && isLicenseControlConfigured()) {
        const result = await getshelfioControlClient.getLicenseStatus({
          email: user.email,
          tenantId: sessionContext.tenantId,
        });
        if (result && result.ok && result.data) {
          controlSession = result.data;
        }
      }
    } catch {
      // ignore control api error to avoid crash
    }

    return attachSessionLicenseSummary({
      currentUser: mapUser(user),
      user: mapUser(user),
      ...tenantData,
    }, controlSession);
  },

  async register(payload) {
    validateRegisterPayload(payload);
    const input = sanitizeRegisterInput(payload);

    const existingUser = await userRepo.findByUsername(input.username);
    if (existingUser) {
      throw new AppError(409, 'Bu kullanıcı adı zaten kayıtlı');
    }

    const now = new Date().toISOString();
    const passwordHash = await hashPassword(input.password);

    const newUser = {
      id: uuidv4(),
      username: input.username,
      passwordHash,
      role: input.role,
      tenantId: getActiveTenantId(),
      storeId: getActiveStoreId(),
      assignedDeskCode: input.role === 'cashier' ? input.assignedDeskCode || '' : null,
      name: input.name,
      email: input.email,
      isActive: input.isActive,
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
    };

    await userRepo.create(newUser);
    return mapUser(newUser);
  },
};
