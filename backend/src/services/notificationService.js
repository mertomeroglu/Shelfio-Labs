import { v4 as uuidv4 } from 'uuid';
import { notificationRepo } from '../repositories/notificationRepository.js';
import { settingsRepo } from '../repositories/settingsRepository.js';
import { taskRepo } from '../repositories/taskRepository.js';
import { userRepo } from '../repositories/userRepository.js';
import { AppError, createNotFoundError } from '../utils/appError.js';
import { parsePagePagination } from '../utils/pagination.js';
import { normalizeTurkishText } from '../utils/turkishText.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const UPCOMING_WINDOW_MS = 24 * 60 * 60 * 1000;
const SLA_START_WINDOW_MS = 4 * 60 * 60 * 1000;
const VALID_SEVERITIES = new Set(['low', 'medium', 'high', 'critical', 'warning']);
const VALID_TARGET_MODES = new Set(['all', 'department', 'role', 'users']);
const MENTION_REGEX = /@([a-zA-Z0-9._-]+)/g;
const SNOOZE_PRESETS = {
  '1h': 60 * 60 * 1000,
  '3h': 3 * 60 * 60 * 1000,
  eod: null,
};

const PRIORITY_WEIGHT = {
  critical: 4,
  high: 3,
  warning: 2,
  medium: 2,
  low: 1,
};

const TYPE_LABELS_TR = {
  overdue: 'Geciken Görev',
  upcoming: 'Yaklaşan Teslim',
  sla: 'SLA Riski',
  assigned: 'Görev Ataması',
  updated: 'Görev Güncellemesi',
  mention: 'Bahsedilme',
  comment: 'Yorum',
  stock_out: 'Stok Bitimi',
  critical_stock: 'Kritik Stok',
  expiry_soon: 'SKT Yaklaşan Ürün',
  skt_expired: 'SKT Geçti',
  system: 'Sistem',
  order: 'Sipariş',
  task: 'Görev',
  purchase_order: 'Sipariş Takibi',
  goods_receipt: 'Mal Kabul',
};

const ACTION_LABELS_TR = {
  open: 'Açıldı',
  inspect: 'İncele',
  'go-task': 'Göreve Git',
  'create-order': 'Sipariş Oluştur',
  'add-stock': 'Stok Ekle',
  click: 'Tıklandı',
  close: 'Kapatıldı',
  dismiss: 'Göz Ardı Edildi',
  archive: 'Arşivlendi',
  mark_read: 'Okundu',
};

const toTurkishLabel = (value, dictionary) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return '-';
  if (dictionary[normalized]) return dictionary[normalized];
  return normalized
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (char) => char.toLocaleUpperCase('tr-TR'));
};

const createNotificationRecord = ({
  userId,
  type,
  title,
  message,
  severity = 'low',
  relatedTaskId = null,
  dedupeKey = null,
  actionUrl = null,
  actionType = null,
  createdBy = null,
  audience = null,
  delivery = null,
  payload = null,
  isDraft = false,
}) => ({
  id: uuidv4(),
  userId,
  type,
  title: normalizeTurkishText(title),
  message: normalizeTurkishText(message),
  severity: VALID_SEVERITIES.has(severity) ? severity : 'low',
  isRead: false,
  createdAt: new Date().toISOString(),
  relatedTaskId,
  dedupeKey,
  actionUrl,
  actionType,
  createdBy,
  audience,
  delivery,
  payload,
  isDraft: Boolean(isDraft),
});

const getActorName = (actorUser) => {
  const safe = String(actorUser?.name || '').trim();
  return safe || 'Bir kullanıcı';
};

const parseDate = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
};

const extractMentionTokens = (text) => {
  const source = String(text || '');
  const tokens = new Set();
  for (const match of source.matchAll(MENTION_REGEX)) {
    const token = String(match[1] || '').trim().toLowerCase();
    if (token) tokens.add(token);
  }
  return Array.from(tokens);
};

const resolveMentionedUserIds = async (text) => {
  const tokens = extractMentionTokens(text);
  if (tokens.length === 0) return [];

  const users = await userRepo.getAll();
  const matched = new Set();

  users.forEach((item) => {
    const username = String(item.username || '').trim().toLowerCase();
    const localPart = username.includes('@') ? username.split('@')[0] : username;
    if (tokens.includes(username) || tokens.includes(localPart)) {
      matched.add(item.id);
    }
  });

  return Array.from(matched);
};

const maybeCreate = async (payload) => {
  if (!payload?.userId || !payload?.type || !payload?.message) {
    return null;
  }

  if (payload.dedupeKey) {
    const existing = await notificationRepo.findByUserAndDedupeKey(payload.userId, payload.dedupeKey);
    if (existing) {
      return existing;
    }
  }

  const record = createNotificationRecord(payload);
  await notificationRepo.create(record);
  return record;
};

const buildEndOfDayIso = () => {
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return end.toISOString();
};

const normalizeStringList = (value) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean);
};

const normalizeTargeting = (raw = {}) => {
  const mode = String(raw.mode || 'all').trim().toLowerCase();
  return {
    mode: VALID_TARGET_MODES.has(mode) ? mode : 'all',
    departments: normalizeStringList(raw.departments),
    roles: normalizeStringList(raw.roles),
    userIds: normalizeStringList(raw.userIds),
  };
};

const normalizeDelivery = (raw = {}) => {
  const sendAt = String(raw.sendAt || '').trim();
  const expiresAt = String(raw.expiresAt || '').trim();
  return {
    sendAt: sendAt || null,
    expiresAt: expiresAt || null,
    isPinned: Boolean(raw.isPinned),
    requireReadReceipt: Boolean(raw.requireReadReceipt),
  };
};

const toLocaleKey = (value) => String(value || '').trim().toLocaleLowerCase('tr-TR');

const resolveTargetUserIds = async (targeting) => {
  const users = await userRepo.getAll();
  const activeUsers = users.filter((item) => item?.isActive);

  if (targeting.mode === 'all') {
    return activeUsers.map((item) => item.id);
  }

  if (targeting.mode === 'department') {
    const departmentSet = new Set(targeting.departments.map((item) => toLocaleKey(item)));
    return activeUsers
      .filter((item) => departmentSet.has(toLocaleKey(item.department)))
      .map((item) => item.id);
  }

  if (targeting.mode === 'role') {
    const roleSet = new Set(targeting.roles.map((item) => String(item || '').trim().toLowerCase()));
    return activeUsers
      .filter((item) => roleSet.has(String(item.role || '').trim().toLowerCase()))
      .map((item) => item.id);
  }

  const idSet = new Set(targeting.userIds);
  return activeUsers
    .filter((item) => idSet.has(item.id))
    .map((item) => item.id);
};

const parseSafeDate = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return date;
};

const normalizeUserPrefs = (prefs = {}) => ({
  mutedTypes: Array.isArray(prefs.mutedTypes) ? prefs.mutedTypes.map((item) => String(item || '').trim()).filter(Boolean) : [],
  mutedNotificationIds: Array.isArray(prefs.mutedNotificationIds) ? prefs.mutedNotificationIds.map((item) => String(item || '').trim()).filter(Boolean) : [],
  snoozedNotificationIds: prefs.snoozedNotificationIds && typeof prefs.snoozedNotificationIds === 'object'
    ? Object.entries(prefs.snoozedNotificationIds).reduce((acc, [key, value]) => {
      const safeKey = String(key || '').trim();
      const safeValue = String(value || '').trim();
      if (safeKey && safeValue) {
        acc[safeKey] = safeValue;
      }
      return acc;
    }, {})
    : {},
});

const getUserNotificationPrefs = async (userId) => {
  const settings = await settingsRepo.getSettings();
  const all = settings.notificationPreferencesByUser && typeof settings.notificationPreferencesByUser === 'object'
    ? settings.notificationPreferencesByUser
    : {};

  return {
    settings,
    all,
    current: normalizeUserPrefs(all[userId] || {}),
  };
};

const saveUserNotificationPrefs = async (userId, prefs) => {
  const { settings, all } = await getUserNotificationPrefs(userId);
  const next = {
    ...settings,
    notificationPreferencesByUser: {
      ...all,
      [userId]: normalizeUserPrefs(prefs),
    },
    updatedAt: new Date().toISOString(),
  };

  await settingsRepo.updateSettings(next);
  return next.notificationPreferencesByUser[userId];
};

const filterByPreferences = (items, prefs) => {
  const now = Date.now();
  return items.filter((item) => {
    if (prefs.mutedNotificationIds.includes(item.id)) return false;
    if (prefs.mutedTypes.includes(String(item.type || '').toLowerCase())) return false;

    const snoozedUntil = prefs.snoozedNotificationIds[item.id];
    if (!snoozedUntil) return true;

    const untilTs = new Date(snoozedUntil).getTime();
    if (!Number.isNaN(untilTs) && untilTs > now) {
      return false;
    }

    return true;
  });
};

const sortByPriorityAndTime = (items) => [...items].sort((left, right) => {
  const severityDelta = (PRIORITY_WEIGHT[right.severity] || 1) - (PRIORITY_WEIGHT[left.severity] || 1);
  if (severityDelta !== 0) return severityDelta;
  return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
});

const isTaskOpen = (task) => String(task?.status || '') !== 'completed';

export const notificationService = {
  async notifyUser({ userId, type, title, message, severity = 'low', relatedTaskId = null, dedupeKey = null, actionUrl = null, actionType = null, payload = null, createdBy = null }) {
    return maybeCreate({
      userId,
      type,
      title,
      message,
      severity,
      relatedTaskId,
      dedupeKey,
      actionUrl,
      actionType,
      payload,
      createdBy,
    });
  },

  async createManualNotification(actorUserId, payload = {}) {
    const title = String(payload.title || '').trim();
    const message = String(payload.message || '').trim();
    const type = String(payload.type || 'system').trim().toLowerCase() || 'system';
    const severity = String(payload.severity || 'medium').trim().toLowerCase();
    const actionUrl = String(payload.targetRoute || payload.actionUrl || '').trim() || '/bildirimler';
    const actionType = String(payload.actionType || '').trim().toLowerCase() || 'system';
    const isDraft = Boolean(payload.saveAsDraft);
    const targeting = normalizeTargeting(payload.targeting || {});
    const delivery = normalizeDelivery(payload.delivery || {});

    if (!title) {
      throw new AppError(400, 'Bildirim başlığı zorunludur.');
    }

    if (!message) {
      throw new AppError(400, 'Bildirim içeriği zorunludur.');
    }

    if (!VALID_SEVERITIES.has(severity)) {
      throw new AppError(400, 'Bildirim önceliği geçersiz.');
    }

    const sendAt = parseSafeDate(delivery.sendAt);
    if (delivery.sendAt && !sendAt) {
      throw new AppError(400, 'Planlanan gönderim tarihi geçersiz.');
    }

    const expiresAt = parseSafeDate(delivery.expiresAt);
    if (delivery.expiresAt && !expiresAt) {
      throw new AppError(400, 'Geçerlilik tarihi geçersiz.');
    }

    if (sendAt && expiresAt && expiresAt.getTime() <= sendAt.getTime()) {
      throw new AppError(400, 'Geçerlilik tarihi, planlanan tarihten sonra olmalıdır.');
    }

    if (targeting.mode === 'department' && targeting.departments.length === 0) {
      throw new AppError(400, 'En az bir departman seçin.');
    }

    if (targeting.mode === 'role' && targeting.roles.length === 0) {
      throw new AppError(400, 'En az bir rol seçin.');
    }

    if (targeting.mode === 'users' && targeting.userIds.length === 0) {
      throw new AppError(400, 'En az bir kullanıcı seçin.');
    }

    const targetUserIds = isDraft
      ? [actorUserId]
      : await resolveTargetUserIds(targeting);

    const finalRecipientIds = new Set(targetUserIds);
    finalRecipientIds.add(actorUserId);

    if (finalRecipientIds.size === 0) {
      throw new AppError(400, 'Hedef kullanıcı bulunamadı.');
    }

    const nowIso = new Date().toISOString();
    const createdRecords = [];

    for (const userId of finalRecipientIds) {
      const record = createNotificationRecord({
        userId,
        type,
        title,
        message,
        severity,
        actionUrl,
        actionType,
        createdBy: actorUserId,
        audience: {
          mode: targeting.mode,
          departments: targeting.departments,
          roles: targeting.roles,
          userIds: targeting.userIds,
        },
        delivery: {
          sendAt: sendAt ? sendAt.toISOString() : nowIso,
          expiresAt: expiresAt ? expiresAt.toISOString() : null,
          isPinned: delivery.isPinned,
          requireReadReceipt: delivery.requireReadReceipt,
        },
        isDraft,
      });

      if (sendAt && sendAt.getTime() > Date.now()) {
        record.createdAt = sendAt.toISOString();
      }

      await notificationRepo.create(record);
      createdRecords.push(record);
    }

    return {
      status: isDraft ? 'draft' : 'sent',
      recipientCount: createdRecords.length,
      targeting,
      delivery: {
        ...delivery,
        sendAt: sendAt ? sendAt.toISOString() : null,
        expiresAt: expiresAt ? expiresAt.toISOString() : null,
      },
      notifications: createdRecords,
    };
  },

  async syncTaskAlertsForUser(userId) {
    if (!userId) return;

    const tasks = await taskRepo.findByAssignedTo(userId);
    const now = Date.now();

    for (const task of tasks) {
      if (!isTaskOpen(task)) {
        continue;
      }

      const dueDate = parseDate(task.dueDate);
      const createdAt = parseDate(task.createdAt);

      if (dueDate) {
        const diff = dueDate.getTime() - now;

        if (diff < 0) {
          const daysLate = Math.max(1, Math.floor((now - dueDate.getTime()) / DAY_MS));
          await maybeCreate({
            userId,
            type: 'overdue',
            title: 'Geciken Görev',
            message: `${task.taskNo || 'Görev'} görevi ${daysLate} gündür gecikti`,
            severity: 'high',
            relatedTaskId: task.id,
            dedupeKey: `overdue:${task.id}:${daysLate}`,
          });
        } else if (diff <= UPCOMING_WINDOW_MS) {
          await maybeCreate({
            userId,
            type: 'upcoming',
            title: 'Yaklaşan Son Tarih',
            message: `${task.taskNo || 'Görev'} görevinin süresi yarın doluyor`,
            severity: 'medium',
            relatedTaskId: task.id,
            dedupeKey: `upcoming:${task.id}:${String(task.dueDate)}`,
          });
        }
      }

      if (task.status === 'pending' && createdAt && (now - createdAt.getTime()) >= SLA_START_WINDOW_MS) {
        await maybeCreate({
          userId,
          type: 'sla',
          title: 'SLA Uyarısı',
          message: `${task.taskNo || 'Görev'} görevi belirlenen sürede bağlatılmadı`,
          severity: 'high',
          relatedTaskId: task.id,
          dedupeKey: `sla:${task.id}`,
        });
      }
    }
  },

  async handleTaskCreated(task, actorUser) {
    if (task?.assignedTo && task.assignedTo !== actorUser?.id) {
      await maybeCreate({
        userId: task.assignedTo,
        type: 'assigned',
        title: 'Yeni Görev Ataması',
        message: `Size yeni bir görev atandı: ${task.title}`,
        severity: 'medium',
        relatedTaskId: task.id,
      });
    }

    const mentionUsers = await resolveMentionedUserIds(task?.description);
    for (const mentionedUserId of mentionUsers) {
      if (mentionedUserId === actorUser?.id) continue;
      await maybeCreate({
        userId: mentionedUserId,
        type: 'mention',
        title: 'Bahsedildiniz',
        message: `${task.title} görevinde sizden bahsedildi`,
        severity: 'medium',
        relatedTaskId: task.id,
      });
    }
  },

  async handleTaskUpdated(previousTask, updatedTask, actorUser, options = {}) {
    const actorName = getActorName(actorUser);
    const statusOnly = Boolean(options.statusOnly);

    const previousAssignee = previousTask?.assignedTo || null;
    const nextAssignee = updatedTask?.assignedTo || null;

    if (nextAssignee && nextAssignee !== previousAssignee && nextAssignee !== actorUser?.id) {
      await maybeCreate({
        userId: nextAssignee,
        type: 'assigned',
        title: 'Yeni Görev Ataması',
        message: `Size yeni bir görev atandı: ${updatedTask.title}`,
        severity: 'medium',
        relatedTaskId: updatedTask.id,
      });
    }

    if (!statusOnly && nextAssignee && nextAssignee !== actorUser?.id) {
      await maybeCreate({
        userId: nextAssignee,
        type: 'updated',
        title: 'Görev Güncellendi',
        message: `${actorName}, ${updatedTask.title} görevini güncelledi`,
        severity: 'low',
        relatedTaskId: updatedTask.id,
      });
    }

    const previousMentions = new Set(await resolveMentionedUserIds(previousTask?.description));
    const nextMentions = await resolveMentionedUserIds(updatedTask?.description);

    for (const mentionedUserId of nextMentions) {
      if (mentionedUserId === actorUser?.id) continue;
      if (previousMentions.has(mentionedUserId)) continue;

      await maybeCreate({
        userId: mentionedUserId,
        type: 'mention',
        title: 'Bahsedildiniz',
        message: `${updatedTask.title} görevinde sizden bahsedildi`,
        severity: 'medium',
        relatedTaskId: updatedTask.id,
      });
    }
  },

  async handleTaskComment(task, commentText, actorUser) {
    const mentionedUsers = await resolveMentionedUserIds(commentText);
    for (const mentionedUserId of mentionedUsers) {
      if (mentionedUserId === actorUser?.id) continue;
      await maybeCreate({
        userId: mentionedUserId,
        type: 'comment',
        title: 'Yorum Bildirimi',
        message: `${task.title} görevinde sizden bahsedildi`,
        severity: 'medium',
        relatedTaskId: task.id,
      });
    }
  },

  async listForUser(userId, { page, limit, onlyUnread, severity, active = true, assigned } = {}) {
    const pagination = parsePagePagination({ page, limit }, { defaultLimit: 30, maxLimit: 200 });
    const all = await notificationRepo.findByUserId(userId);
    const { current: prefs } = await getUserNotificationPrefs(userId);
    const filtered = filterByPreferences(all, prefs)
      .filter((item) => !onlyUnread || !item.isRead)
      .filter((item) => !severity || item.severity === severity)
      .filter((item) => active === false || !item.isRead || item.status === 'active')
      .filter((item) => !assigned || Boolean(item.relatedTaskId))
      .map((item) => ({ ...item, mutedByRule: false }));

    const sorted = sortByPriorityAndTime(filtered);
    const items = sorted.slice(pagination.skip, pagination.skip + pagination.limit);

    return {
      items,
      pagination: {
        mode: 'offset',
        page: pagination.page,
        limit: pagination.limit,
        total: sorted.length,
        totalPages: Math.max(1, Math.ceil(sorted.length / pagination.limit)),
        hasNextPage: pagination.skip + items.length < sorted.length,
        nextCursor: null,
        cursorVersion: null,
      },
      filters: {
        unread: Boolean(onlyUnread),
        severity: severity || null,
        active: Boolean(active),
        assigned: Boolean(assigned),
      },
      sort: { key: 'priority_createdAt_desc', direction: 'desc' },
    };
  },

  async getSummary(userId) {
    const all = await notificationRepo.findByUserId(userId);
    const { current: prefs } = await getUserNotificationPrefs(userId);
    const visible = filterByPreferences(all, prefs);
    const unreadCount = visible.filter((item) => !item.isRead).length;
    return {
      unreadCount,
      totalCount: visible.length,
      severityCounts: visible.reduce((acc, item) => {
        const key = item.severity || 'low';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {}),
    };
  },

  async markAsRead(userId, notificationId) {
    const existing = await notificationRepo.findById(notificationId);
    if (!existing || existing.userId !== userId) {
      throw createNotFoundError('Bildirim bulunamadı');
    }

    if (existing.isRead) {
      return existing;
    }

    const updated = {
      ...existing,
      isRead: true,
    };

    await notificationRepo.updateById(notificationId, updated);
    return updated;
  },

  async trackAction(userId, notificationId, actionName = 'open') {
    const existing = await notificationRepo.findById(notificationId);
    if (!existing || existing.userId !== userId) {
      throw createNotFoundError('Bildirim bulunamadı');
    }

    const now = new Date().toISOString();
    const actionLog = Array.isArray(existing.actionLog) ? [...existing.actionLog] : [];
    actionLog.push({ at: now, action: String(actionName || 'open') });

    const updated = {
      ...existing,
      isRead: true,
      actionTakenAt: now,
      actionLog,
    };

    await notificationRepo.updateById(notificationId, updated);
    return updated;
  },

  async snoozeForUser(userId, notificationId, preset = '1h') {
    const existing = await notificationRepo.findById(notificationId);
    if (!existing || existing.userId !== userId) {
      throw createNotFoundError('Bildirim bulunamadı');
    }

    const normalizedPreset = String(preset || '1h').toLowerCase();
    const offset = SNOOZE_PRESETS[normalizedPreset];
    const snoozedUntil = offset === null
      ? buildEndOfDayIso()
      : new Date(Date.now() + (offset || SNOOZE_PRESETS['1h'])).toISOString();

    const { current } = await getUserNotificationPrefs(userId);
    const nextPrefs = {
      ...current,
      snoozedNotificationIds: {
        ...current.snoozedNotificationIds,
        [notificationId]: snoozedUntil,
      },
    };

    await saveUserNotificationPrefs(userId, nextPrefs);
    return { notificationId, snoozedUntil };
  },

  async muteNotificationForUser(userId, notificationId) {
    const existing = await notificationRepo.findById(notificationId);
    if (!existing || existing.userId !== userId) {
      throw createNotFoundError('Bildirim bulunamadı');
    }

    const { current } = await getUserNotificationPrefs(userId);
    const next = {
      ...current,
      mutedNotificationIds: current.mutedNotificationIds.includes(notificationId)
        ? current.mutedNotificationIds
        : [...current.mutedNotificationIds, notificationId],
    };

    await saveUserNotificationPrefs(userId, next);
    return { notificationId, muted: true };
  },

  async muteTypeForUser(userId, type) {
    const normalizedType = String(type || '').trim().toLowerCase();
    const { current } = await getUserNotificationPrefs(userId);
    const next = {
      ...current,
      mutedTypes: current.mutedTypes.includes(normalizedType)
        ? current.mutedTypes
        : [...current.mutedTypes, normalizedType],
    };

    await saveUserNotificationPrefs(userId, next);
    return { type: normalizedType, muted: true };
  },

  async getAnalytics(userId) {
    const all = await notificationRepo.findByUserId(userId);
    const typeMap = new Map();
    const actionMap = new Map();

    all.forEach((item) => {
      const type = String(item.type || 'system').toLowerCase();
      typeMap.set(type, (typeMap.get(type) || 0) + 1);

      const log = Array.isArray(item.actionLog) ? item.actionLog : [];
      log.forEach((entry) => {
        const action = String(entry?.action || 'open').toLowerCase();
        actionMap.set(action, (actionMap.get(action) || 0) + 1);
      });
    });

    const mostFrequentType = [...typeMap.entries()].sort((a, b) => b[1] - a[1])[0] || null;
    const mostActioned = [...actionMap.entries()].sort((a, b) => b[1] - a[1])[0] || null;

    return {
      total: all.length,
      mostFrequentType: mostFrequentType
        ? {
          type: mostFrequentType[0],
          typeLabel: toTurkishLabel(mostFrequentType[0], TYPE_LABELS_TR),
          count: mostFrequentType[1],
        }
        : null,
      mostActioned: mostActioned
        ? {
          action: mostActioned[0],
          actionLabel: toTurkishLabel(mostActioned[0], ACTION_LABELS_TR),
          count: mostActioned[1],
        }
        : null,
    };
  },

  async markAllAsRead(userId) {
    await notificationRepo.markAllAsRead(userId);
    return this.getSummary(userId);
  },

  async removeManyForUser(userId, notificationIds = []) {
    if (!Array.isArray(notificationIds) || notificationIds.length === 0) {
      return this.getSummary(userId);
    }

    for (const notificationId of notificationIds) {
      const existing = await notificationRepo.findById(notificationId);
      if (existing && existing.userId === userId) {
        await notificationRepo.deleteById(notificationId);
      }
    }

    return this.getSummary(userId);
  },
};

