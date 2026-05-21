import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRootDir = path.resolve(__dirname, '..', '..');

dotenv.config({ path: process.env.ESL_BRIDGE_ENV || path.resolve(backendRootDir, '.env.bridge') });
dotenv.config({ path: path.resolve(backendRootDir, '.env') });

const trimSlash = (value = '') => String(value || '').trim().replace(/\/+$/, '');
const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};
const parseBoolean = (value, fallback = false) => {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return fallback;
  return ['1', 'true', 'yes', 'y', 'on'].includes(normalized);
};

const config = {
  localApiBaseUrl: trimSlash(process.env.LOCAL_ESL_BASE_URL || process.env.LOCAL_API_BASE_URL || 'http://localhost:4000/api'),
  productionApiBaseUrl: trimSlash(process.env.PRODUCTION_API_BASE_URL || ''),
  deviceId: String(process.env.ESL_DEVICE_ID || '').trim(),
  token: String(process.env.ESL_DEVICE_TOKEN || '').trim(),
  intervalSeconds: parsePositiveInt(process.env.HEARTBEAT_INTERVAL_SECONDS, 30),
  enableLabelSync: parseBoolean(process.env.ENABLE_LABEL_SYNC, true),
  labelSyncIntervalSeconds: parsePositiveInt(process.env.LABEL_SYNC_INTERVAL_SECONDS, 30),
  enableScheduleSync: parseBoolean(process.env.ENABLE_SCHEDULE_SYNC, true),
  scheduleSyncIntervalSeconds: parsePositiveInt(process.env.SCHEDULE_SYNC_INTERVAL_SECONDS, 30),
  localFreshSeconds: parsePositiveInt(process.env.LOCAL_HEARTBEAT_FRESH_SECONDS, 100),
  requestTimeoutMs: parsePositiveInt(process.env.ESL_BRIDGE_REQUEST_TIMEOUT_MS, 10000),
  localIp: String(process.env.LOCAL_ESL_IP || process.env.LOCAL_IP || '').trim(),
  signal: String(process.env.ESL_SIGNAL || '').trim(),
};

let lastLabelSyncAttemptAt = 0;
let lastSyncedAssignmentHash = '';
let lastScheduleSyncAttemptAt = 0;
let lastSyncedScheduleHash = '';

const requireConfig = () => {
  const missing = [];
  if (!config.productionApiBaseUrl) missing.push('PRODUCTION_API_BASE_URL');
  if (!config.deviceId) missing.push('ESL_DEVICE_ID');
  if (!config.token) missing.push('ESL_DEVICE_TOKEN');
  if (missing.length) {
    throw new Error(`Eksik bridge env: ${missing.join(', ')}`);
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchJson = async (url, options = {}) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        'x-esl-device-token': config.token,
        ...(options.headers || {}),
      },
    });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const error = new Error(payload?.message || `HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    return payload?.data ?? payload;
  } finally {
    clearTimeout(timeoutId);
  }
};

const readLocalHeartbeatState = async () => {
  const url = `${config.localApiBaseUrl}/esl/devices/${encodeURIComponent(config.deviceId)}/heartbeat-state`;
  return fetchJson(url);
};

const sendProductionHeartbeat = async (localState) => {
  const url = `${config.productionApiBaseUrl}/esl/devices/${encodeURIComponent(config.deviceId)}/heartbeat`;
  return fetchJson(url, {
    method: 'POST',
    body: JSON.stringify({
      deviceId: config.deviceId,
      battery: localState?.battery,
      signal: config.signal || undefined,
      firmwareVersion: localState?.firmwareVersion || undefined,
      localIp: config.localIp || localState?.localIp || undefined,
      timestamp: localState?.lastHeartbeatAt || new Date().toISOString(),
    }),
  });
};

const readProductionAssignmentState = async () => {
  const url = `${config.productionApiBaseUrl}/esl/devices/${encodeURIComponent(config.deviceId)}/assignment-state`;
  return fetchJson(url);
};

const sendLocalBridgeLabelSync = async (assignmentState) => {
  const url = `${config.localApiBaseUrl}/esl/devices/${encodeURIComponent(config.deviceId)}/bridge-label-sync`;
  return fetchJson(url, {
    method: 'POST',
    body: JSON.stringify({
      deviceId: config.deviceId,
      assignedProductId: assignmentState?.assignedProductId || null,
      template: assignmentState?.template || 'standard',
      lastSyncAt: assignmentState?.lastSyncAt || null,
      updatedAt: assignmentState?.updatedAt || null,
      clearLabel: Boolean(assignmentState?.clearLabel),
      assignmentVersion: assignmentState?.assignmentVersion || assignmentState?.assignmentHash || '',
      assignmentHash: assignmentState?.assignmentHash || assignmentState?.assignmentVersion || '',
      label: assignmentState?.label || null,
    }),
  });
};

const readProductionScheduleState = async () => {
  const url = `${config.productionApiBaseUrl}/esl/settings/schedule-state`;
  return fetchJson(url);
};

const sendLocalBridgeScheduleSync = async (scheduleState) => {
  const url = `${config.localApiBaseUrl}/esl/settings/bridge-schedule-sync`;
  return fetchJson(url, {
    method: 'POST',
    body: JSON.stringify({
      timezone: scheduleState?.timezone || 'Europe/Istanbul',
      openingTime: scheduleState?.openingTime || '10:00',
      closingTime: scheduleState?.closingTime || '22:00',
      closedDays: Array.isArray(scheduleState?.closedDays) ? scheduleState.closedDays : [],
      holidayMode: Boolean(scheduleState?.holidayMode),
      weeklySchedule: Array.isArray(scheduleState?.weeklySchedule) ? scheduleState.weeklySchedule : [],
      specialDays: Array.isArray(scheduleState?.specialDays) ? scheduleState.specialDays : [],
      updatedAt: scheduleState?.updatedAt || null,
      scheduleHash: scheduleState?.scheduleHash || '',
    }),
  });
};

const isFreshLocalHeartbeat = (localState) => {
  if (!localState || localState.status !== 'online') return false;
  const age = Number(localState.heartbeatAgeSeconds);
  return Number.isFinite(age) && age <= config.localFreshSeconds;
};

const log = (level, message, meta = {}) => {
  const safeMeta = { ...meta };
  delete safeMeta.token;
  const suffix = Object.keys(safeMeta).length ? ` ${JSON.stringify(safeMeta)}` : '';
  console[level](`[esl-bridge] ${new Date().toISOString()} ${message}${suffix}`);
};

const syncHeartbeatOnce = async () => {
  const localState = await readLocalHeartbeatState();
  if (!isFreshLocalHeartbeat(localState)) {
    log('warn', 'local heartbeat taze değil, production heartbeat gönderilmedi', {
      deviceId: config.deviceId,
      status: localState?.status || 'unknown',
      ageSeconds: localState?.heartbeatAgeSeconds ?? null,
    });
    return;
  }

  const result = await sendProductionHeartbeat(localState);
  log('info', 'production heartbeat gönderildi', {
    deviceId: config.deviceId,
    lastHeartbeatAt: result?.lastHeartbeatAt || null,
  });
};

const shouldRunLabelSync = () => (
  config.enableLabelSync
  && Date.now() - lastLabelSyncAttemptAt >= config.labelSyncIntervalSeconds * 1000
);

const shouldRunScheduleSync = () => (
  config.enableScheduleSync
  && Date.now() - lastScheduleSyncAttemptAt >= config.scheduleSyncIntervalSeconds * 1000
);

const syncLabelOnce = async () => {
  lastLabelSyncAttemptAt = Date.now();
  const assignmentState = await readProductionAssignmentState();
  const assignmentHash = assignmentState?.assignmentHash || assignmentState?.assignmentVersion || '';
  if (assignmentHash && assignmentHash === lastSyncedAssignmentHash) {
    return;
  }

  const result = await sendLocalBridgeLabelSync(assignmentState);
  if (assignmentHash) {
    lastSyncedAssignmentHash = assignmentHash;
  }
  log('info', 'label update synced', {
    deviceId: config.deviceId,
    synced: result?.synced !== false,
    assignmentHash: assignmentHash || result?.assignmentHash || null,
  });
};

const syncScheduleOnce = async () => {
  lastScheduleSyncAttemptAt = Date.now();
  const scheduleState = await readProductionScheduleState();
  const scheduleHash = scheduleState?.scheduleHash || '';
  if (scheduleHash && scheduleHash === lastSyncedScheduleHash) {
    return;
  }

  const result = await sendLocalBridgeScheduleSync(scheduleState);
  if (scheduleHash) {
    lastSyncedScheduleHash = scheduleHash;
  }
  log('info', 'schedule settings synced', {
    synced: result?.synced !== false,
    scheduleHash: scheduleHash || result?.scheduleHash || null,
    sourceUpdatedAt: scheduleState?.updatedAt || null,
  });
};

const runOnce = async () => {
  await syncHeartbeatOnce();
  const syncTasks = [];
  if (shouldRunLabelSync()) {
    syncTasks.push(syncLabelOnce().catch((error) => {
      log('error', 'label sync hata aldı', {
        deviceId: config.deviceId,
        message: error?.message || 'Bilinmeyen hata',
      });
    }));
  }
  if (shouldRunScheduleSync()) {
    syncTasks.push(syncScheduleOnce().catch((error) => {
      log('error', 'schedule sync hata aldı', {
        message: error?.message || 'Bilinmeyen hata',
      });
    }));
  }
  if (syncTasks.length) {
    await Promise.all(syncTasks);
  }
};

const main = async () => {
  requireConfig();
  log('info', 'bridge başladı', {
    deviceId: config.deviceId,
    localApiBaseUrl: config.localApiBaseUrl,
    productionApiBaseUrl: config.productionApiBaseUrl,
    intervalSeconds: config.intervalSeconds,
    enableLabelSync: config.enableLabelSync,
    labelSyncIntervalSeconds: config.labelSyncIntervalSeconds,
    enableScheduleSync: config.enableScheduleSync,
    scheduleSyncIntervalSeconds: config.scheduleSyncIntervalSeconds,
  });

  let failureCount = 0;
  while (true) {
    try {
      await runOnce();
      failureCount = 0;
      await sleep(config.intervalSeconds * 1000);
    } catch (error) {
      failureCount += 1;
      const backoffSeconds = Math.min(120, config.intervalSeconds * Math.max(1, failureCount));
      log('error', 'heartbeat döngüsü hata aldı', {
        deviceId: config.deviceId,
        message: error?.message || 'Bilinmeyen hata',
        backoffSeconds,
      });
      await sleep(backoffSeconds * 1000);
    }
  }
};

main().catch((error) => {
  log('error', 'bridge başlatılamadı', { message: error?.message || 'Bilinmeyen hata' });
  process.exit(1);
});
