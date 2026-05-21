import { notificationService } from '../services/notificationService.js';
import { sendListResponse } from '../utils/listResponse.js';

const parseBoolean = (value) => {
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  return false;
};

export const notificationController = {
  async create(req, res, next) {
    try {
      const data = await notificationService.createManualNotification(req.user.id, req.body || {});
      res.status(201).json(data);
    } catch (error) {
      next(error);
    }
  },

  async list(req, res, next) {
    try {
      const notifications = await notificationService.listForUser(req.user.id, {
        page: req.query.page,
        limit: req.query.limit,
        onlyUnread: parseBoolean(req.query.unread),
        severity: typeof req.query.severity === 'string' ? req.query.severity : undefined,
        active: req.query.active === undefined ? true : parseBoolean(req.query.active),
        assigned: parseBoolean(req.query.assigned),
      });
      sendListResponse(res, notifications);
    } catch (error) {
      next(error);
    }
  },

  async summary(req, res, next) {
    try {
      const data = await notificationService.getSummary(req.user.id);
      res.json(data);
    } catch (error) {
      next(error);
    }
  },

  async markAsRead(req, res, next) {
    try {
      const data = await notificationService.markAsRead(req.user.id, req.params.id);
      res.json(data);
    } catch (error) {
      next(error);
    }
  },

  async markAllAsRead(req, res, next) {
    try {
      const data = await notificationService.markAllAsRead(req.user.id);
      res.json(data);
    } catch (error) {
      next(error);
    }
  },

  async removeMany(req, res, next) {
    try {
      const payload = Array.isArray(req.body?.ids) ? req.body.ids : [];
      const ids = payload
        .map((id) => String(id || '').trim())
        .filter(Boolean);

      const data = await notificationService.removeManyForUser(req.user.id, ids);
      res.json(data);
    } catch (error) {
      next(error);
    }
  },

  async trackAction(req, res, next) {
    try {
      const action = String(req.body?.action || 'open');
      const data = await notificationService.trackAction(req.user.id, req.params.id, action);
      res.json(data);
    } catch (error) {
      next(error);
    }
  },

  async snooze(req, res, next) {
    try {
      const preset = String(req.body?.preset || '1h');
      const data = await notificationService.snoozeForUser(req.user.id, req.params.id, preset);
      res.json(data);
    } catch (error) {
      next(error);
    }
  },

  async mute(req, res, next) {
    try {
      const data = await notificationService.muteNotificationForUser(req.user.id, req.params.id);
      res.json(data);
    } catch (error) {
      next(error);
    }
  },

  async muteType(req, res, next) {
    try {
      const type = String(req.body?.type || '').trim();
      const data = await notificationService.muteTypeForUser(req.user.id, type);
      res.json(data);
    } catch (error) {
      next(error);
    }
  },

  async analytics(req, res, next) {
    try {
      const data = await notificationService.getAnalytics(req.user.id);
      res.json(data);
    } catch (error) {
      next(error);
    }
  },
};
