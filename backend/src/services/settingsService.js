import { settingsRepo } from '../repositories/settingsRepository.js';
import { userRepo } from '../repositories/userRepository.js';
import { sanitizeSettingsInput, validateSettingsPayload } from '../utils/validators.js';
import { AppError } from '../utils/appError.js';
import { logisticsTariffService } from './logisticsTariffService.js';
import { eslService } from './eslService.js';

const DEFAULT_DESK_PINS = {
  B1: '1234',
  B2: '1234',
  B3: '1234',
  B4: '1234',
  B5: '1234',
  B6: '1234',
  B7: '1234',
  B8: '1234',
};

const VALID_DESKS = new Set(Object.keys(DEFAULT_DESK_PINS));

const normalizePin = (value) => String(value || '').trim();

const MAX_AUDIT_LOGS = 500;
const MAX_LOGIN_ACTIVITIES = 200;
const MAX_DEVELOPER_LOGS = 3000;
const UTF8_BOM = '\uFEFF';

const safeObject = (value) => (value && typeof value === 'object' ? value : {});

const SENSITIVE_KEY_PATTERN = /(password|pass|token|secret|authorization|cookie|pin)/i;

const parseDateBoundary = (value, suffix = 'T00:00:00.000Z') => {
  const normalized = String(value || '').trim();
  if (!normalized) return null;
  const date = new Date(`${normalized}${suffix}`);
  return Number.isFinite(date.getTime()) ? date : null;
};

const normalizeListLimit = (value, fallback, max) => Math.min(max, Math.max(1, Number(value) || fallback));

const truncateString = (value, maxLength = 4000) => {
  const text = String(value ?? '');
  return text.length > maxLength ? `${text.slice(0, maxLength)}...(truncated)` : text;
};

const tryParseJsonString = (value) => {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text || !/^[{\[]/.test(text)) return value;
  try {
    return JSON.parse(text);
  } catch {
    return value;
  }
};

const normalizeStructuredLogValue = (value) => {
  const parsed = tryParseJsonString(value);
  return maskSensitiveData(parsed);
};

const extractReadableLogMessage = (value) => {
  const parsed = tryParseJsonString(value);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const candidates = [
      parsed.message,
      parsed.error,
      parsed.detail,
      parsed.details,
      parsed.title,
      parsed.reason,
    ];
    const resolved = candidates.find((item) => String(item || '').trim());
    if (resolved) {
      return truncateString(resolved, 1200);
    }
  }
  return truncateString(typeof parsed === 'string' ? parsed : JSON.stringify(parsed), 1200);
};

const maskSensitiveData = (value, depth = 0) => {
  if (value === null || value === undefined) return value;
  if (depth > 6) return '[max-depth]';

  if (typeof value === 'string') {
    return truncateString(value, 4000);
  }

  if (typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => maskSensitiveData(item, depth + 1));
  }

  const masked = {};
  Object.entries(value).forEach(([key, raw]) => {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      masked[key] = '***';
      return;
    }
    masked[key] = maskSensitiveData(raw, depth + 1);
  });
  return masked;
};

const normalizeDeveloperLevel = (value) => {
  const level = String(value || '').trim().toLowerCase();
  if (['error', 'warning', 'info'].includes(level)) return level;
  return 'error';
};

const normalizeDeveloperSource = (value) => {
  const source = String(value || '').trim().toLowerCase();
  if (['frontend', 'backend', 'api'].includes(source)) return source;
  return 'backend';
};

const pickChangedKeys = (previous = {}, next = {}) => {
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  const changed = [];

  keys.forEach((key) => {
    if (['updatedAt', 'auditLogs', 'loginActivities'].includes(key)) return;
    const before = JSON.stringify(previous[key]);
    const after = JSON.stringify(next[key]);
    if (before !== after) changed.push(key);
  });

  return changed;
};

const appendAuditLog = (settings, entry) => {
  const current = Array.isArray(settings.auditLogs) ? settings.auditLogs : [];
  const next = [entry, ...current].slice(0, MAX_AUDIT_LOGS);
  return next;
};

const appendLoginActivity = (settings, entry) => {
  const current = Array.isArray(settings.loginActivities) ? settings.loginActivities : [];
  const next = [entry, ...current].slice(0, MAX_LOGIN_ACTIVITIES);
  return next;
};

const appendDeveloperLog = (settings, entry) => {
  const current = Array.isArray(settings.developerLogs) ? settings.developerLogs : [];
  return [entry, ...current].slice(0, MAX_DEVELOPER_LOGS);
};

const LOG_GROUP_FIELDS = {
  activity: 'loginActivities',
  login: 'loginActivities',
  audit: 'auditLogs',
  developer: 'developerLogs',
};

const assertFourDigitPin = (pin, message = 'PIN 4 haneli sayisal formatta olmalidir') => {
  if (!/^\d{4}$/.test(normalizePin(pin))) {
    throw new AppError(400, message);
  }
};

export const settingsService = {
  async get(currentUser) {
    const settings = await settingsRepo.getSettings();
    const base = {
      ...settings,
      posPin: undefined,
      roleManagementPin: undefined,
      deskPins: undefined,
    };

    if (currentUser?.role === 'admin') {
      return {
        ...base,
        hasPosPin: Boolean(settings.posPin),
        hasRoleManagementPin: Boolean(settings.roleManagementPin),
        loginActivities: Array.isArray(settings.loginActivities) ? settings.loginActivities : [],
        auditLogs: Array.isArray(settings.auditLogs) ? settings.auditLogs : [],
        developerLogs: Array.isArray(settings.developerLogs) ? settings.developerLogs : [],
        deskPinMeta: {
          B1: Boolean(settings?.deskPins?.B1),
          B2: Boolean(settings?.deskPins?.B2),
          B3: Boolean(settings?.deskPins?.B3),
          B4: Boolean(settings?.deskPins?.B4),
          B5: Boolean(settings?.deskPins?.B5),
          B6: Boolean(settings?.deskPins?.B6),
          B7: Boolean(settings?.deskPins?.B7),
          B8: Boolean(settings?.deskPins?.B8),
        },
      };
    }

    return base;
  },

  async update(payload, currentUser) {
    validateSettingsPayload(payload, { partial: true });
    const current = await settingsRepo.getSettings();
    const input = sanitizeSettingsInput({ ...current, ...payload });

    const deskPins = {
      ...DEFAULT_DESK_PINS,
      ...(current.deskPins || {}),
      ...(input.deskPins || {}),
    };

    const actorId = String(currentUser?.id || 'system');
    const actorName = String(currentUser?.name || currentUser?.username || 'Sistem');

    const nextSettings = {
      ...current,
      ...input,
      deskPins,
      roleManagementPin: input.roleManagementPin || current.roleManagementPin || '1234',
      updatedAt: new Date().toISOString(),
    };

    const changedKeys = pickChangedKeys(current, nextSettings);
    const auditEntry = {
      id: `${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      actorId,
      actorName,
      action: 'settings_update',
      changedKeys,
      at: new Date().toISOString(),
      details: changedKeys.join(', '),
    };
    nextSettings.auditLogs = appendAuditLog(current, auditEntry);

    await settingsRepo.updateSettings(nextSettings);
    if (Object.prototype.hasOwnProperty.call(payload?.customerRelations || {}, 'campaigns')) {
      void eslService.syncCampaignLabels({ actorUser: currentUser }).catch((error) => {
        console.error('[campaign-esl-sync:error]', error);
      });
    }
    return nextSettings;
  },

  async recordLoginActivity(user, meta = {}) {
    const settings = await settingsRepo.getSettings();

    const entry = {
      id: `${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      userId: String(user?.id || ''),
      userName: String(user?.name || user?.username || 'Bilinmeyen Kullanıcı'),
      at: new Date().toISOString(),
      ipAddress: String(meta.ipAddress || ''),
      userAgent: String(meta.userAgent || ''),
      device: String(meta.device || ''),
    };

    const nextSettings = {
      ...settings,
      loginActivities: appendLoginActivity(settings, entry),
      updatedAt: new Date().toISOString(),
    };

    await settingsRepo.updateSettings(nextSettings);
    return entry;
  },

  async getLoginActivities(currentUser, query = {}) {
    const settings = await settingsRepo.getSettings();
    const all = Array.isArray(settings.loginActivities) ? settings.loginActivities : [];

    const users = await userRepo.getAll();
    const usersById = new Map((Array.isArray(users) ? users : []).map((item) => [String(item.id || ''), item]));

    const enrich = (item) => {
      const user = usersById.get(String(item.userId || ''));
      return {
        ...item,
        username: user?.username || '',
        registerPin: user?.registerPin || '',
      };
    };

    const active = currentUser?.role === 'admin'
      ? all
      : all.filter((item) => item.userId === currentUser?.id);

    const filters = {
      user: String(query.user || '').trim(),
      browser: String(query.browser || '').trim(),
      ip: String(query.ip || '').trim().toLocaleLowerCase('tr-TR'),
      search: String(query.search || '').trim().toLocaleLowerCase('tr-TR'),
      fromDate: parseDateBoundary(query.from, 'T00:00:00.000Z'),
      toDate: parseDateBoundary(query.to, 'T23:59:59.999Z'),
    };

    const rows = active
      .map(enrich)
      .filter((item) => {
        const loginDate = new Date(item.createdAt || item.loginAt || item.loggedInAt || item.timestamp || item.at || 0);
        if (filters.fromDate && (!Number.isFinite(loginDate.getTime()) || loginDate < filters.fromDate)) return false;
        if (filters.toDate && (!Number.isFinite(loginDate.getTime()) || loginDate > filters.toDate)) return false;

        const userName = String(item.userName || item.username || '').trim();
        if (filters.user && userName !== filters.user) return false;

        const userAgent = String(item.userAgent || item.browserInfo || item.device || '').toLowerCase();
        if (filters.browser && !userAgent.includes(filters.browser.toLocaleLowerCase('tr-TR'))) return false;

        const ipValue = String(item.ipAddress || item.ip || '').toLocaleLowerCase('tr-TR');
        if (filters.ip && !ipValue.includes(filters.ip)) return false;

        if (filters.search) {
          const haystack = [
            userName,
            item.username,
            item.email,
            item.registerPin,
            item.ipAddress,
            item.ip,
            item.userAgent,
            item.browserInfo,
            item.device,
          ]
            .filter(Boolean)
            .join(' ')
            .toLocaleLowerCase('tr-TR');
          if (!haystack.includes(filters.search)) return false;
        }

        return true;
      });

    const limit = normalizeListLimit(query.limit, 30, MAX_LOGIN_ACTIVITIES);
    return {
      items: rows.slice(0, limit),
      total: rows.length,
      limit,
    };
  },

  async getAuditLogs(currentUser, query = {}) {
    if (!currentUser || currentUser.role !== 'admin') {
      throw new AppError(403, 'Audit log erişimi için yönetici yetkisi gereklidir');
    }

    const settings = await settingsRepo.getSettings();
    const all = Array.isArray(settings.auditLogs) ? settings.auditLogs : [];
    const action = String(query.action || '').trim();
    const user = String(query.user || '').trim();
    const search = String(query.search || '').trim().toLocaleLowerCase('tr-TR');
    const fromDate = parseDateBoundary(query.from, 'T00:00:00.000Z');
    const toDate = parseDateBoundary(query.to, 'T23:59:59.999Z');

    const rows = all.filter((item) => {
      const createdAt = new Date(item.createdAt || item.at || 0);
      if (fromDate && (!Number.isFinite(createdAt.getTime()) || createdAt < fromDate)) return false;
      if (toDate && (!Number.isFinite(createdAt.getTime()) || createdAt > toDate)) return false;

      const rowAction = String(item.actionLabel || item.action || '').trim();
      if (action && rowAction !== action) return false;

      const actorName = String(item.actorName || item.actor || item.userName || '').trim();
      if (user && actorName !== user) return false;

      if (search) {
        const haystack = [
          rowAction,
          actorName,
          item.details,
          item.detail,
          item.summary,
          item.note,
          item.id,
        ]
          .filter(Boolean)
          .join(' ')
          .toLocaleLowerCase('tr-TR');
        if (!haystack.includes(search)) return false;
      }

      return true;
    });

    const limit = normalizeListLimit(query.limit, 100, MAX_AUDIT_LOGS);
    return {
      items: rows.slice(0, limit),
      total: rows.length,
      limit,
    };
  },

  async recordDeveloperLog(payload = {}, currentUser, requestMeta = {}) {
    const settings = await settingsRepo.getSettings();
    const now = new Date().toISOString();

    const requestPayload = normalizeStructuredLogValue(payload.requestPayload ?? payload.payload ?? null);
    const responsePayload = normalizeStructuredLogValue(payload.response);
    const payloadSnapshot = normalizeStructuredLogValue(payload.payload ?? requestPayload);
    const requestUrl = payload.requestUrl || payload.endpoint || requestMeta.requestUrl || '';
    const userId = payload.userId || payload.user_id || currentUser?.id || null;
    const userName = payload.userName || currentUser?.name || currentUser?.username || null;

    const entry = {
      id: `${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      timestamp: now,
      level: normalizeDeveloperLevel(payload.level),
      message: extractReadableLogMessage(payload.message || 'Bilinmeyen hata'),
      source: normalizeDeveloperSource(payload.source || requestMeta.source),
      action: truncateString(payload.action || requestMeta.action || 'Bilinmeyen işlem', 300),
      endpoint: truncateString(payload.endpoint || requestMeta.endpoint || '', 500),
      requestUrl: truncateString(requestUrl, 700),
      requestPayload,
      payload: payloadSnapshot,
      response: responsePayload,
      stack: truncateString(payload.stack || '', 8000),
      statusCode: Number(payload.statusCode || payload.status_code || requestMeta.statusCode || 0) || undefined,
      userId,
      userName,
      user: userName || undefined,
      browserInfo: truncateString(payload.browserInfo || payload.browser || requestMeta.browserInfo || '', 600),
      ip: truncateString(payload.ip || requestMeta.ip || '', 80),
      errorType: truncateString(payload.errorType || '', 120),
    };

    const nextSettings = {
      ...settings,
      developerLogs: appendDeveloperLog(settings, entry),
      updatedAt: now,
    };

    await settingsRepo.updateSettings(nextSettings);
    return entry;
  },

  async getDeveloperLogs(currentUser, query = {}) {
    if (!currentUser || currentUser.role !== 'admin') {
      throw new AppError(403, 'Geliştirici logları için yönetici yetkisi gereklidir');
    }

    const settings = await settingsRepo.getSettings();
    let rows = Array.isArray(settings.developerLogs) ? settings.developerLogs : [];

    const level = String(query.level || '').trim().toLowerCase();
    const source = String(query.source || '').trim().toLowerCase();
    const userId = String(query.userId || '').trim();
    const search = String(query.search || '').trim().toLowerCase();
    const fromDate = query.from ? new Date(`${String(query.from)}T00:00:00.000Z`) : null;
    const toDate = query.to ? new Date(`${String(query.to)}T23:59:59.999Z`) : null;

    if (['error', 'warning', 'info'].includes(level)) {
      rows = rows.filter((item) => String(item.level || '').toLowerCase() === level);
    }

    if (['frontend', 'backend', 'api'].includes(source)) {
      rows = rows.filter((item) => String(item.source || '').toLowerCase() === source);
    }

    if (userId) {
      rows = rows.filter((item) => String(item.userId || '') === userId);
    }

    if (fromDate && Number.isFinite(fromDate.getTime())) {
      rows = rows.filter((item) => {
        const ts = new Date(item.timestamp || item.at || item.createdAt || 0);
        return Number.isFinite(ts.getTime()) && ts >= fromDate;
      });
    }

    if (toDate && Number.isFinite(toDate.getTime())) {
      rows = rows.filter((item) => {
        const ts = new Date(item.timestamp || item.at || item.createdAt || 0);
        return Number.isFinite(ts.getTime()) && ts <= toDate;
      });
    }

    if (search) {
      rows = rows.filter((item) => {
        const haystack = [
          item.message,
          item.endpoint,
          item.requestUrl,
          item.action,
          item.source,
        ].join(' ').toLowerCase();
        return haystack.includes(search);
      });
    }

    const limit = normalizeListLimit(query.limit, 200, 1000);
    return {
      items: rows.slice(0, limit),
      total: rows.length,
      limit,
    };
  },

  async clearLogs(type, currentUser) {
    if (!currentUser || currentUser.role !== 'admin') {
      throw new AppError(403, 'Log kayıtlarını temizlemek için yönetici yetkisi gereklidir');
    }

    const key = String(type || '').trim().toLowerCase();
    const field = LOG_GROUP_FIELDS[key];
    if (!field) {
      throw new AppError(400, 'Temizlenecek log tipi geçersiz');
    }

    const settings = await settingsRepo.getSettings();
    const previousCount = Array.isArray(settings[field]) ? settings[field].length : 0;
    const now = new Date().toISOString();

    const nextSettings = {
      ...settings,
      [field]: [],
      updatedAt: now,
    };

    await settingsRepo.updateSettings(nextSettings);
    return { type: key, field, clearedCount: previousCount };
  },

  async exportDeveloperLogsCsv(currentUser, query = {}) {
    const { items: rows } = await this.getDeveloperLogs(currentUser, { ...query, limit: 1000 });
    const escape = (value) => {
      const source = String(value ?? '');
      if (source.includes(',') || source.includes('"') || source.includes('\n')) {
        return `"${source.replace(/"/g, '""')}"`;
      }
      return source;
    };

    const header = ['id', 'timestamp', 'level', 'message', 'source', 'action', 'endpoint', 'requestUrl', 'statusCode', 'userId', 'userName', 'ip', 'errorType'];
    const lines = [header.join(',')];

    rows.forEach((item) => {
      const line = [
        item.id,
        item.timestamp,
        item.level,
        item.message,
        item.source,
        item.action,
        item.endpoint,
        item.requestUrl,
        item.statusCode,
        item.userId,
        item.userName,
        item.ip,
        item.errorType,
      ].map(escape).join(',');
      lines.push(line);
    });

    return `${UTF8_BOM}${lines.join('\n')}`;
  },

  async exportAuditLogsCsv(currentUser) {
    const { items: rows } = await this.getAuditLogs(currentUser, { limit: 500 });
    const escape = (value) => {
      const source = String(value ?? '');
      if (source.includes(',') || source.includes('"') || source.includes('\n')) {
        return `"${source.replace(/"/g, '""')}"`;
      }
      return source;
    };

    const header = ['id', 'actorId', 'actorName', 'action', 'changedKeys', 'details', 'at'];
    const lines = [header.join(',')];

    rows.forEach((item) => {
      const line = [
        item.id,
        item.actorId,
        item.actorName,
        item.action,
        Array.isArray(item.changedKeys) ? item.changedKeys.join('|') : '',
        item.details || '',
        item.at,
      ].map(escape).join(',');
      lines.push(line);
    });

    return `${UTF8_BOM}${lines.join('\n')}`;
  },

  async getLogisticsTariffs() {
    const settings = await settingsRepo.getSettings();
    const rows = logisticsTariffService.normalizeTariffs(settings.logisticsTariffs || []);
    return {
      rows,
      cargoTypes: logisticsTariffService.buildCargoTypeSummary(rows),
      stats: {
        activeCargoTypeCount: logisticsTariffService.buildCargoTypeSummary(rows).filter((item) => item.isActive).length,
        coldChainTypeCount: logisticsTariffService.buildCargoTypeSummary(rows).filter((item) => item.isColdChain).length,
        frozenChainTypeCount: logisticsTariffService.buildCargoTypeSummary(rows).filter((item) => item.isFrozenChain).length,
      },
    };
  },

  async updateLogisticsTariffs(payload = {}, currentUser) {
    if (!currentUser || currentUser.role !== 'admin') {
      throw new AppError(403, 'Lojistik tarifeleri güncellemek için yönetici yetkisi gereklidir');
    }

    const settings = await settingsRepo.getSettings();
    const input = sanitizeSettingsInput({ ...settings, logisticsTariffs: payload.logisticsTariffs || [] });
    validateSettingsPayload({ logisticsTariffs: input.logisticsTariffs || [] }, { partial: true });

    const nextSettings = {
      ...settings,
      logisticsTariffs: logisticsTariffService.normalizeTariffs(input.logisticsTariffs || []),
      updatedAt: new Date().toISOString(),
    };

    const auditEntry = {
      id: `${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      actorId: String(currentUser?.id || 'system'),
      actorName: String(currentUser?.name || currentUser?.username || 'Sistem'),
      action: 'settings_logistics_tariffs_update',
      changedKeys: ['logisticsTariffs'],
      at: new Date().toISOString(),
      details: `Lojistik tarifeleri güncellendi (${nextSettings.logisticsTariffs.length} satır)`,
    };
    nextSettings.auditLogs = appendAuditLog(settings, auditEntry);

    await settingsRepo.updateSettings(nextSettings);

    return {
      rows: nextSettings.logisticsTariffs,
      cargoTypes: logisticsTariffService.buildCargoTypeSummary(nextSettings.logisticsTariffs),
    };
  },

  async calculateLogisticsQuote(payload = {}) {
    const settings = await settingsRepo.getSettings();
    const rows = logisticsTariffService.normalizeTariffs(settings.logisticsTariffs || []);

    const quote = logisticsTariffService.calculateQuote({
      rows,
      cargoTypeCode: payload.cargoTypeCode,
      caseQty: payload.caseQty,
      lineItems: payload.lineItems,
      manualOverrideTl: payload.manualOverrideTl,
      storageType: payload.storageType,
      storageTypes: payload.storageTypes,
      distanceType: payload.distanceType,
      isInternalTransfer: payload.isInternalTransfer === true,
    });

    const compatibleRows = logisticsTariffService.filterTariffsForSelection(rows, {
      storageType: payload.storageType,
      distanceType: payload.distanceType,
      isInternalTransfer: payload.isInternalTransfer === true,
    });

    return {
      quote,
      availableCargoTypes: logisticsTariffService.buildCargoTypeSummary(compatibleRows),
    };
  },

  async verifyPin(pin, type = 'pos', deskCode, currentUser, registerPin) {
    if (!pin) {
      throw new AppError(400, 'PIN zorunludur');
    }

    const settings = await settingsRepo.getSettings();
    const normalizedType = String(type || 'pos').trim().toLowerCase();

    if (normalizedType === 'desk') {
      const normalizedDesk = String(deskCode || '').trim().toUpperCase();
      if (!VALID_DESKS.has(normalizedDesk)) {
        throw new AppError(400, 'Geçersiz kasa kodu');
      }

      const normalizedRegisterPin = String(registerPin || '').trim();
      if (!/^\d{4}$/.test(normalizedRegisterPin)) {
        throw new AppError(400, 'Sicil no 4 haneli olmalıdır');
      }

      if (!currentUser?.id) {
        throw new AppError(401, 'Geçersiz oturum');
      }

      const authenticatedUser = await userRepo.findById(currentUser.id);
      if (!authenticatedUser) {
        throw new AppError(401, 'Geçersiz oturum');
      }

      if (!authenticatedUser.isActive) {
        throw new AppError(403, 'Bu kullanıcı pasif durumda');
      }

      if (!['admin', 'cashier'].includes(authenticatedUser.role)) {
        throw new AppError(403, 'Bu kullanıcı için kasa erişim yetkisi yok');
      }

      if (String(authenticatedUser.registerPin || '').trim() !== normalizedRegisterPin) {
        throw new AppError(401, 'Geçersiz sicil numarası');
      }

      if (authenticatedUser.role === 'cashier') {
        const assignedDeskCode = String(authenticatedUser.assignedDeskCode || '').trim().toUpperCase();
        if (!assignedDeskCode) {
          throw new AppError(403, 'Bu kasiyer için atanmış kasa bulunmuyor');
        }
        if (assignedDeskCode !== normalizedDesk) {
          throw new AppError(403, `Bu kullanıcı sadece ${assignedDeskCode} kasasını açabilir`);
        }
      }

      if (normalizedDesk === 'B8') {
        if (authenticatedUser.role !== 'admin') {
          throw new AppError(403, 'Yönetim Kasası için yetkiniz yok');
        }
      }

      const pins = {
        ...DEFAULT_DESK_PINS,
        ...(settings.deskPins || {}),
      };

      if (String(pin) !== String(pins[normalizedDesk])) {
        throw new AppError(401, 'Geçersiz PIN');
      }

      return {
        verified: true,
        deskCode: normalizedDesk,
        registerPin: normalizedRegisterPin,
        userId: authenticatedUser.id,
        userName: authenticatedUser.name,
      };
    }

    if (normalizedType === 'role-management') {
      if (!currentUser || currentUser.role !== 'admin') {
        throw new AppError(403, 'Rol yönetimi için yönetici yetkisi gerekli');
      }
      const rolePin = settings.roleManagementPin || '1234';
      if (String(pin) !== String(rolePin)) {
        throw new AppError(401, 'Geçersiz PIN');
      }
      return { verified: true };
    }

    const storedPin = settings.posPin || '1234';
    if (String(pin) !== String(storedPin)) {
      throw new AppError(401, 'Geçersiz PIN');
    }

    return { verified: true };
  },

  async updateSystemDeskPin(deskCode, newPin, currentUser) {
    if (!currentUser || currentUser.role !== 'admin') {
      throw new AppError(403, 'Bu işlem için yönetici yetkisi gereklidir');
    }

    const normalizedDesk = String(deskCode || '').trim().toUpperCase();
    if (!VALID_DESKS.has(normalizedDesk)) {
      throw new AppError(400, 'Geçersiz kasa kodu');
    }

    const normalizedNewPin = normalizePin(newPin);
    if (!normalizedNewPin) {
      throw new AppError(400, 'Yeni PIN boş olamaz');
    }
    assertFourDigitPin(normalizedNewPin, 'PIN 4 haneli olmalıdır');

    const settings = await settingsRepo.getSettings();
    const currentDeskPins = {
      ...DEFAULT_DESK_PINS,
      ...(settings.deskPins || {}),
    };

    const previousPin = normalizePin(currentDeskPins[normalizedDesk]);
    if (normalizedNewPin === previousPin) {
      throw new AppError(400, 'Yeni PIN mevcut PIN ile aynı olamaz');
    }

    const nextDeskPins = {
      ...currentDeskPins,
      [normalizedDesk]: normalizedNewPin,
    };

    const nextSettings = {
      ...settings,
      deskPins: nextDeskPins,
      updatedAt: new Date().toISOString(),
    };

    const auditEntry = {
      id: `${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      actorId: String(currentUser?.id || 'system'),
      actorName: String(currentUser?.name || currentUser?.username || 'Sistem'),
      action: 'settings_desk_pin_update',
      changedKeys: [`deskPins.${normalizedDesk}`],
      at: new Date().toISOString(),
      details: `${normalizedDesk} kasa PIN güncellendi`,
    };
    nextSettings.auditLogs = appendAuditLog(settings, auditEntry);

    await settingsRepo.updateSettings(nextSettings);

    return {
      deskCode: normalizedDesk,
      updatedAt: nextSettings.updatedAt,
      deskPins: nextDeskPins,
    };
  },
};
