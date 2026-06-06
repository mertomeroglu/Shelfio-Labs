import { stockService } from '../services/stockService.js';
import { expiredBatchNotificationService } from '../services/expiredBatchNotificationService.js';
import { expiryTrackingService } from '../services/expiryTrackingService.js';
import { sendListResponse } from '../utils/listResponse.js';

export const stockController = {
  async getStocks(req, res, next) {
    try {
      const result = await stockService.getStocks(req.query || {});
      sendListResponse(res, result);
    } catch (error) {
      next(error);
    }
  },

  async listMovements(req, res, next) {
    try {
      const result = await stockService.listMovements(req.query);
      sendListResponse(res, result);
    } catch (error) {
      next(error);
    }
  },

  async movementsSummary(req, res, next) {
    try {
      const data = await stockService.getMovementSummary(req.query);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async expiredBatchWarnings(req, res, next) {
    try {
      const data = await stockService.listExpiredBatchWarnings(req.query || {});
      sendListResponse(res, data);
    } catch (error) {
      next(error);
    }
  },

  async expiryTracking(req, res, next) {
    try {
      const data = await expiryTrackingService.getReadModel(req.query || {});
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async sktPolicyManualReview(req, res, next) {
    try {
      const data = await stockService.listSktPolicyManualReview(req.query || {});
      sendListResponse(res, data);
    } catch (error) {
      next(error);
    }
  },

  async expiredBatchNotificationDryRun(req, res, next) {
    try {
      const data = await expiredBatchNotificationService.buildPlan({ dryRun: true });
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async runExpiredBatchNotifications(req, res, next) {
    try {
      const data = await expiredBatchNotificationService.run({ dryRun: false });
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async disposeExpiredBatches(req, res, next) {
    try {
      const data = await stockService.disposeExpiredBatches(req.body || {}, req.user.id);
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async upsertBatch(req, res, next) {
    try {
      const data = await stockService.upsertBatch(req.params.productId, req.body || {});
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async stockIn(req, res, next) {
    try {
      const data = await stockService.createMovement('IN', req.body, req.user.id);
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async stockOut(req, res, next) {
    try {
      const data = await stockService.createMovement('OUT', req.body, req.user.id);
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async adjustStock(req, res, next) {
    try {
      const data = await stockService.createMovement('ADJUSTMENT', req.body, req.user.id);
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async transferStock(req, res, next) {
    try {
      const data = await stockService.transferStock(req.body, req.user.id);
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async cancelMovement(req, res, next) {
    try {
      const data = await stockService.cancelMovement(req.params.id, req.user.id, req.body || {});
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
};
