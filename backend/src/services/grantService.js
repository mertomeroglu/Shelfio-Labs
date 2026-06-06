import { v4 as uuidv4 } from 'uuid';
import { temporaryPermissionGrantRepo } from '../repositories/temporaryPermissionGrantRepository.js';
import { accessAuditLogRepo } from '../repositories/accessAuditLogRepository.js';
import { userRepo } from '../repositories/userRepository.js';
import { createNotFoundError } from '../utils/appError.js';
import { formatPermissionLabel } from '../utils/displayLabels.js';
import { notificationService } from './notificationService.js';

const nowIso = () => new Date().toISOString();

export const grantService = {
  async createGrant({ userId, permission, storeId, requestId, approvedBy, approvedDurationMinutes, reason = '' }) {
    const current = await temporaryPermissionGrantRepo.getAll();
    const now = Date.now();

    const existingActive = current.find((item) => (
      item.userId === userId
      && item.permission === permission
      && item.storeId === storeId
      && item.status === 'active'
      && new Date(item.expiresAt).getTime() > now
    ));

    const expiresAt = new Date(Date.now() + (approvedDurationMinutes * 60 * 1000)).toISOString();

    if (existingActive) {
      const updated = {
        ...existingActive,
        expiresAt: new Date(Math.max(new Date(existingActive.expiresAt).getTime(), new Date(expiresAt).getTime())).toISOString(),
        updatedAt: nowIso(),
        approvedBy,
      };
      await temporaryPermissionGrantRepo.updateById(existingActive.id, updated);
      return updated;
    }

    const grant = {
      id: uuidv4(),
      userId,
      permission,
      storeId,
      requestId: requestId || null,
      status: 'active',
      approvedBy,
      reason,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      expiresAt,
      revokedAt: null,
      revokedBy: null,
    };

    await temporaryPermissionGrantRepo.create(grant);

    await accessAuditLogRepo.create({
      id: uuidv4(),
      action: 'grant_created',
      userId,
      permission,
      storeId,
      requestId: requestId || null,
      actorId: approvedBy,
      actorIp: null,
      metadata: { approvedDurationMinutes },
      createdAt: nowIso(),
    });

    await notificationService.notifyUser({
      userId,
      type: 'access_granted',
      title: 'Geçici Erişim Onaylandı',
      message: `${formatPermissionLabel(permission, permission)} için geçici erişimin onaylandı.`,
      severity: 'medium',
      actionType: 'system',
      actionUrl: '/erisim-taleplerim',
    });

    return grant;
  },

  async revokeGrant(grantId, actorUser, ip) {
    const grant = await temporaryPermissionGrantRepo.findById(grantId);
    if (!grant) throw createNotFoundError('Geçici erişim kaydı bulunamadı');

    if (grant.status !== 'active') {
      return grant;
    }

    const updated = {
      ...grant,
      status: 'revoked',
      revokedAt: nowIso(),
      revokedBy: actorUser.id,
      updatedAt: nowIso(),
    };

    await temporaryPermissionGrantRepo.updateById(grant.id, updated);

    await accessAuditLogRepo.create({
      id: uuidv4(),
      action: 'grant_revoked',
      userId: grant.userId,
      permission: grant.permission,
      storeId: grant.storeId,
      requestId: grant.requestId || null,
      actorId: actorUser.id,
      actorIp: ip || null,
      metadata: {},
      createdAt: nowIso(),
    });

    return updated;
  },

  async expireTemporaryGrants() {
    const all = await temporaryPermissionGrantRepo.getAll();
    const users = await userRepo.getAll();
    const userMap = new Map(users.map((item) => [item.id, item]));
    const now = Date.now();

    for (const grant of all) {
      const owner = userMap.get(grant.userId);

      const shouldExpire = grant.status === 'active' && new Date(grant.expiresAt).getTime() <= now;
      const shouldRevokeForDisabledUser = grant.status === 'active' && owner && owner.isActive === false;

      if (!shouldExpire && !shouldRevokeForDisabledUser) {
        continue;
      }

      const nextStatus = shouldExpire ? 'expired' : 'revoked';
      const updated = {
        ...grant,
        status: nextStatus,
        updatedAt: nowIso(),
        revokedAt: nextStatus === 'revoked' ? nowIso() : grant.revokedAt,
        revokedBy: nextStatus === 'revoked' ? 'system' : grant.revokedBy,
      };

      await temporaryPermissionGrantRepo.updateById(grant.id, updated);

      await accessAuditLogRepo.create({
        id: uuidv4(),
        action: nextStatus === 'expired' ? 'grant_expired' : 'grant_revoked_disabled_user',
        userId: grant.userId,
        permission: grant.permission,
        storeId: grant.storeId,
        requestId: grant.requestId || null,
        actorId: 'system',
        actorIp: null,
        metadata: {},
        createdAt: nowIso(),
      });

      await notificationService.notifyUser({
        userId: grant.userId,
        type: 'access_expired',
        title: 'Geçici Erişim Sonlandı',
        message: `${formatPermissionLabel(grant.permission, grant.permission)} için geçici erişimin sona erdi.`,
        severity: 'low',
        actionType: 'system',
        actionUrl: '/erisim-taleplerim',
      });
    }
  },
};

