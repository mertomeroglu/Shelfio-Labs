import { accessRequestService } from '../services/accessRequestService.js';

export const accessRequestController = {
  async create(req, res, next) {
    try {
      const data = await accessRequestService.createRequest({
        user: req.user,
        permission: req.body.permission,
        reason: req.body.reason,
        pageAccess: req.body.pageAccess,
        requestedDurationMinutes: req.body.requestedDurationMinutes,
        ip: req.ip,
      });
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async list(req, res, next) {
    try {
      const data = await accessRequestService.listRequests(req.user, req.query);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async approve(req, res, next) {
    try {
      const data = await accessRequestService.approveRequest({
        requestId: req.params.id,
        actorUser: req.user,
        durationMinutes: req.body.durationMinutes,
        note: req.body.note,
        ip: req.ip,
      });
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async reject(req, res, next) {
    try {
      const data = await accessRequestService.rejectRequest({
        requestId: req.params.id,
        actorUser: req.user,
        note: req.body.note,
        ip: req.ip,
      });
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async extend(req, res, next) {
    try {
      const data = await accessRequestService.extendRequestDuration({
        requestId: req.params.id,
        actorUser: req.user,
        durationMinutes: req.body.durationMinutes,
        note: req.body.note,
        ip: req.ip,
      });
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async bulk(req, res, next) {
    try {
      const data = await accessRequestService.bulkAction({
        actorUser: req.user,
        ids: req.body.ids,
        action: req.body.action,
        durationMinutes: req.body.durationMinutes,
        note: req.body.note,
        ip: req.ip,
      });
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
};
