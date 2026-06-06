import { v4 as uuidv4 } from 'uuid';
import { accessRequestRepo } from '../repositories/accessRequestRepository.js';
import { accessAuditLogRepo } from '../repositories/accessAuditLogRepository.js';
import { createNotFoundError, AppError } from '../utils/appError.js';
import { formatPermissionLabel, replacePermissionCodesInText } from '../utils/displayLabels.js';
import { grantService } from './grantService.js';
import { notificationService } from './notificationService.js';
import { userRepo } from '../repositories/userRepository.js';
import { temporaryPermissionGrantRepo } from '../repositories/temporaryPermissionGrantRepository.js';

const nowIso = () => new Date().toISOString();
const ACCESS_SLA_MINUTES = 240;

const RISK_LEVELS = {
  high: 'high',
  medium: 'medium',
  low: 'low',
};

const resolveRiskLevel = (permission = '') => {
  const value = String(permission || '').toLowerCase();

  if (/purchase:create|purchase:approve|user:update|settings:update|stock:update/.test(value)) {
    return RISK_LEVELS.high;
  }

  if (/esl:update|task:update|temporary_grant:revoke|access_request:approve|access_request:reject/.test(value)) {
    return RISK_LEVELS.medium;
  }

  return RISK_LEVELS.low;
};

const parseBoolean = (value) => ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());

const parseDateStart = (value) => {
  if (!value) return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
};

const parseDateEnd = (value) => {
  if (!value) return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(23, 59, 59, 999);
  return date;
};

const parseDurationMinutes = (value) => {
  const minutes = Number(value);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw new AppError(400, 'Geçerli bir süre (dakika) girilmelidir');
  }
  if (minutes > 60 * 24 * 30) {
    throw new AppError(400, 'Maksimum süre 30 gündür');
  }
  return Math.floor(minutes);
};

export const accessRequestService = {
  async createRequest({ user, permission, reason, pageAccess, requestedDurationMinutes, ip }) {
    const requestedPermission = String(permission || '').trim();
    if (!requestedPermission) throw new AppError(400, 'Permission zorunludur');

    const duration = parseDurationMinutes(requestedDurationMinutes);
    const normalizedReason = String(reason || '').trim();
    if (!normalizedReason) {
      throw new AppError(400, 'Talep nedeni zorunludur');
    }
    const permissionLabel = formatPermissionLabel(requestedPermission, requestedPermission);
    const storeId = String(user?.storeId || 'store-main').trim() || 'store-main';
    const normalizedPageAccess = pageAccess && typeof pageAccess === 'object'
      ? {
        pagePath: String(pageAccess.pagePath || '').trim(),
        pageLabel: String(pageAccess.pageLabel || '').trim(),
        displayLabel: String(pageAccess.displayLabel || '').trim(),
      }
      : null;

    const duplicatePending = await accessRequestRepo.findPendingByUserPermission(user.id, requestedPermission, storeId);
    if (duplicatePending) {
      throw new AppError(409, 'Aynı yetki için bekleyen bir talep zaten mevcut');
    }

    const entity = {
      id: uuidv4(),
      userId: user.id,
      storeId,
      permission: requestedPermission,
      reason: normalizedReason,
      requestedDurationMinutes: duration,
      status: 'pending',
      createdBy: user.id,
      reviewedBy: null,
      reviewNote: null,
      pageAccess: normalizedPageAccess,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      reviewedAt: null,
    };

    await accessRequestRepo.create(entity);

    await accessAuditLogRepo.create({
      id: uuidv4(),
      action: 'request_created',
      userId: user.id,
      permission: requestedPermission,
      storeId,
      requestId: entity.id,
      actorId: user.id,
      actorIp: ip || null,
      metadata: { requestedDurationMinutes: duration, pageAccess: normalizedPageAccess },
      createdAt: nowIso(),
    });

    const admins = (await userRepo.getAll()).filter((item) => item.role === 'admin' && item.isActive);
    for (const admin of admins) {
      await notificationService.notifyUser({
        userId: admin.id,
        type: 'access_request_opened',
        title: 'Yeni Erişim Talebi',
        message: `${user.name || user.username} ${permissionLabel} için talep oluşturdu.`,
        severity: 'medium',
        actionType: 'system',
        actionUrl: '/erisim-talepleri',
      });
    }

    return entity;
  },

  async listRequests(currentUser, query = {}) {
    const [all, auditLogs, users, grants] = await Promise.all([
      accessRequestRepo.getAll(),
      accessAuditLogRepo.getAll(),
      userRepo.getAll(),
      temporaryPermissionGrantRepo.getAll(),
    ]);

    const userMap = new Map(users.map((item) => [item.id, item]));
    const logsByRequestId = new Map();
    const grantsByRequestId = new Map();
    for (const log of auditLogs) {
      if (!log.requestId) continue;
      if (!logsByRequestId.has(log.requestId)) logsByRequestId.set(log.requestId, []);
      logsByRequestId.get(log.requestId).push(log);
    }

    for (const grant of grants) {
      if (!grant.requestId) continue;
      if (!grantsByRequestId.has(grant.requestId)) {
        grantsByRequestId.set(grant.requestId, []);
      }
      grantsByRequestId.get(grant.requestId).push(grant);
    }

    const queryStatus = String(query.status || '').trim();
    const queryUserId = String(query.userId || '').trim();
    const queryPermission = String(query.permission || '').trim();
    const querySearch = String(query.search || '').trim().toLowerCase();
    const queryAssignedToMe = parseBoolean(query.assignedToMe);
    const startDate = parseDateStart(query.startDate);
    const endDate = parseDateEnd(query.endDate);
    const now = Date.now();

    const canViewAll = currentUser.role === 'admin';
    let filtered = canViewAll
      ? all
      : all.filter((item) => item.userId === currentUser.id);

    if (currentUser.role !== 'admin') {
      filtered = filtered.filter((item) => item.storeId === currentUser.storeId);
    } else if (query.storeId) {
      filtered = filtered.filter((item) => item.storeId === String(query.storeId));
    }

    if (queryStatus) {
      filtered = filtered.filter((item) => item.status === queryStatus);
    }

    if (queryUserId) {
      filtered = filtered.filter((item) => String(item.userId || '').toLowerCase().includes(queryUserId.toLowerCase()));
    }

    if (queryPermission) {
      filtered = filtered.filter((item) => String(item.permission || '').toLowerCase().includes(queryPermission.toLowerCase()));
    }

    if (queryAssignedToMe) {
      filtered = filtered.filter((item) => (
        item.status === 'pending'
          ? String(item.assignedTo || '') === String(currentUser.id)
          : String(item.reviewedBy || '') === String(currentUser.id)
      ));
    }

    if (startDate) {
      filtered = filtered.filter((item) => {
        const createdAt = new Date(item.createdAt).getTime();
        return Number.isFinite(createdAt) && createdAt >= startDate.getTime();
      });
    }

    if (endDate) {
      filtered = filtered.filter((item) => {
        const createdAt = new Date(item.createdAt).getTime();
        return Number.isFinite(createdAt) && createdAt <= endDate.getTime();
      });
    }

    if (querySearch) {
      filtered = filtered.filter((item) => {
        const source = [item.userId, item.permission, item.reason, item.reviewNote].map((part) => String(part || '').toLowerCase()).join(' ');
        return source.includes(querySearch);
      });
    }

    const enriched = filtered.map((item) => {
      const createdAtMs = new Date(item.createdAt).getTime();
      const reviewedAtMs = item.reviewedAt ? new Date(item.reviewedAt).getTime() : null;
      const requestGrants = (grantsByRequestId.get(item.id) || [])
        .slice()
        .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime());
      const linkedGrant = requestGrants[0] || null;
      const linkedGrantExpiresAtMs = linkedGrant?.expiresAt ? new Date(linkedGrant.expiresAt).getTime() : null;
      const computedGrantStatus = linkedGrant
        ? (linkedGrant.status === 'active' && Number.isFinite(linkedGrantExpiresAtMs) && linkedGrantExpiresAtMs <= now
          ? 'expired'
          : linkedGrant.status)
        : null;
      const activeRemainingMinutes = computedGrantStatus === 'active' && Number.isFinite(linkedGrantExpiresAtMs)
        ? Math.max(0, Math.floor((linkedGrantExpiresAtMs - now) / 60000))
        : null;
      const effectiveStatus = item.status === 'approved' && computedGrantStatus
        ? (computedGrantStatus === 'active' ? 'active' : computedGrantStatus)
        : item.status;

      const waitingMinutes = Math.max(0, Math.floor(((item.status === 'pending' ? now : (reviewedAtMs || now)) - createdAtMs) / 60000));
      const slaRemainingMinutes = item.status === 'pending' ? ACCESS_SLA_MINUTES - waitingMinutes : null;

      const requestLogs = (logsByRequestId.get(item.id) || [])
        .slice()
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .map((log) => ({
          ...log,
          actorName: userMap.get(log.actorId)?.name || userMap.get(log.actorId)?.username || log.actorId,
        }));

      return {
        ...item,
        reason: String(item.reason || '').trim(),
        reasonDisplay: replacePermissionCodesInText(item.reason, '-'),
        reviewNoteDisplay: replacePermissionCodesInText(item.reviewNote, '-'),
        permissionLabel: formatPermissionLabel(item.permission, item.permission),
        reviewerName: item.reviewedBy ? (userMap.get(item.reviewedBy)?.name || userMap.get(item.reviewedBy)?.username || item.reviewedBy) : null,
        requesterName: userMap.get(item.userId)?.name || userMap.get(item.userId)?.username || item.userId,
        riskLevel: resolveRiskLevel(item.permission),
        waitingMinutes,
        approvalMinutes: reviewedAtMs ? Math.max(0, Math.floor((reviewedAtMs - createdAtMs) / 60000)) : null,
        slaTargetMinutes: ACCESS_SLA_MINUTES,
        slaRemainingMinutes,
        slaBreached: item.status === 'pending' ? slaRemainingMinutes <= 0 : false,
        auditTrail: requestLogs,
        grantId: linkedGrant?.id || null,
        grantStatus: computedGrantStatus,
        grantExpiresAt: linkedGrant?.expiresAt || null,
        activeRemainingMinutes,
        effectiveStatus,
      };
    });

    return enriched.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  async approveRequest({ requestId, actorUser, durationMinutes, note, ip }) {
    const request = await accessRequestRepo.findById(requestId);
    if (!request) throw createNotFoundError('Erişim talebi bulunamadı');
    if (request.status !== 'pending') throw new AppError(400, 'Talep bekleyen durumda deşil');

    const approvedDurationMinutes = parseDurationMinutes(durationMinutes || request.requestedDurationMinutes);

    const updatedRequest = {
      ...request,
      status: 'approved',
      assignedTo: actorUser.id,
      reviewedBy: actorUser.id,
      reviewNote: String(note || '').trim() || null,
      reviewedAt: nowIso(),
      updatedAt: nowIso(),
    };

    await accessRequestRepo.updateById(request.id, updatedRequest);

    const grant = await grantService.createGrant({
      userId: request.userId,
      permission: request.permission,
      storeId: request.storeId,
      requestId: request.id,
      approvedBy: actorUser.id,
      approvedDurationMinutes,
      reason: String(note || '').trim(),
    });

    await accessAuditLogRepo.create({
      id: uuidv4(),
      action: 'request_approved',
      userId: request.userId,
      permission: request.permission,
      storeId: request.storeId,
      requestId: request.id,
      actorId: actorUser.id,
      actorIp: ip || null,
      metadata: { approvedDurationMinutes },
      createdAt: nowIso(),
    });

    return {
      request: updatedRequest,
      grant,
    };
  },

  async rejectRequest({ requestId, actorUser, note, ip }) {
    const request = await accessRequestRepo.findById(requestId);
    if (!request) throw createNotFoundError('Erişim talebi bulunamadı');
    if (request.status !== 'pending') throw new AppError(400, 'Talep bekleyen durumda deşil');

    const updatedRequest = {
      ...request,
      status: 'rejected',
      assignedTo: actorUser.id,
      reviewedBy: actorUser.id,
      reviewNote: String(note || '').trim() || null,
      reviewedAt: nowIso(),
      updatedAt: nowIso(),
    };

    await accessRequestRepo.updateById(request.id, updatedRequest);

    await accessAuditLogRepo.create({
      id: uuidv4(),
      action: 'request_rejected',
      userId: request.userId,
      permission: request.permission,
      storeId: request.storeId,
      requestId: request.id,
      actorId: actorUser.id,
      actorIp: ip || null,
      metadata: {},
      createdAt: nowIso(),
    });

    await notificationService.notifyUser({
      userId: request.userId,
      type: 'access_request_rejected',
      title: 'Erişim Talebi Reddedildi',
      message: `${formatPermissionLabel(request.permission, request.permission)} için erişim talebin reddedildi.`,
      severity: 'medium',
      actionType: 'system',
      actionUrl: '/erisim-taleplerim',
    });

    return updatedRequest;
  },

  async extendRequestDuration({ requestId, actorUser, durationMinutes, note, ip }) {
    const request = await accessRequestRepo.findById(requestId);
    if (!request) throw createNotFoundError('Erişim talebi bulunamadı');

    const nextDuration = parseDurationMinutes(durationMinutes);

    if (request.status === 'pending') {
      const oldDuration = Number(request.requestedDurationMinutes || 0);

      const updatedRequest = {
        ...request,
        assignedTo: actorUser.id,
        requestedDurationMinutes: nextDuration,
        reviewNote: String(note || '').trim() || request.reviewNote || null,
        updatedAt: nowIso(),
      };

      await accessRequestRepo.updateById(request.id, updatedRequest);

      await accessAuditLogRepo.create({
        id: uuidv4(),
        action: 'request_duration_extended',
        userId: request.userId,
        permission: request.permission,
        storeId: request.storeId,
        requestId: request.id,
        actorId: actorUser.id,
        actorIp: ip || null,
        metadata: { oldDurationMinutes: oldDuration, newDurationMinutes: nextDuration },
        createdAt: nowIso(),
      });

      return updatedRequest;
    }

    if (request.status !== 'approved') {
      throw new AppError(400, 'Sadece bekleyen veya aktif taleplerin süresi güncellenebilir');
    }

    const allGrants = await temporaryPermissionGrantRepo.getAll();
    const relatedGrant = allGrants
      .filter((item) => item.requestId === request.id)
      .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime())[0];

    if (!relatedGrant || relatedGrant.status !== 'active') {
      throw new AppError(400, 'Bu talep için aktif erişim kaydı bulunamadı');
    }

    const oldExpiresAtMs = relatedGrant.expiresAt ? new Date(relatedGrant.expiresAt).getTime() : null;
    const oldRemainingMinutes = Number.isFinite(oldExpiresAtMs)
      ? Math.max(0, Math.floor((oldExpiresAtMs - Date.now()) / 60000))
      : null;

    const updatedGrant = {
      ...relatedGrant,
      expiresAt: new Date(Date.now() + (nextDuration * 60 * 1000)).toISOString(),
      updatedAt: nowIso(),
      reason: String(note || '').trim() || relatedGrant.reason || '',
    };

    await temporaryPermissionGrantRepo.updateById(relatedGrant.id, updatedGrant);

    await accessAuditLogRepo.create({
      id: uuidv4(),
      action: 'grant_duration_updated',
      userId: request.userId,
      permission: request.permission,
      storeId: request.storeId,
      requestId: request.id,
      actorId: actorUser.id,
      actorIp: ip || null,
      metadata: { oldRemainingMinutes, newDurationMinutes: nextDuration },
      createdAt: nowIso(),
    });

    return {
      request,
      grant: updatedGrant,
    };
  },

  async bulkAction({ actorUser, ids, action, durationMinutes, note, ip }) {
    const uniqueIds = Array.from(new Set((Array.isArray(ids) ? ids : []).map((id) => String(id || '').trim()).filter(Boolean)));
    if (!uniqueIds.length) throw new AppError(400, 'Toplu işlem için en az bir talep seçilmelidir');

    const normalizedAction = String(action || '').trim().toLowerCase();
    if (!['approve', 'reject', 'extend'].includes(normalizedAction)) {
      throw new AppError(400, 'Desteklenmeyen toplu işlem türü');
    }

    const results = [];
    for (const requestId of uniqueIds) {
      try {
        if (normalizedAction === 'approve') {
          await this.approveRequest({ requestId, actorUser, durationMinutes, note, ip });
        } else if (normalizedAction === 'reject') {
          await this.rejectRequest({ requestId, actorUser, note, ip });
        } else {
          await this.extendRequestDuration({ requestId, actorUser, durationMinutes, note, ip });
        }
        results.push({ requestId, success: true });
      } catch (error) {
        results.push({ requestId, success: false, message: error.message || 'İşlem başarısız' });
      }
    }

    const successCount = results.filter((item) => item.success).length;
    const failCount = results.length - successCount;

    return {
      action: normalizedAction,
      total: results.length,
      successCount,
      failCount,
      results,
    };
  },
};

