import { eslService } from '../services/eslService.js';
import { sendListResponse } from '../utils/listResponse.js';

export const eslController = {
  async listDevices(req, res, next) {
    try {
      const data = await eslService.listDevices();
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async getDevice(req, res, next) {
    try {
      const data = await eslService.getDeviceById(req.params.id);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async getCurrentLabel(req, res, next) {
    try {
      const data = await eslService.getCurrentLabel(req.params.id);
      res.json(data);
    } catch (error) {
      next(error);
    }
  },

  async getScheduleStatus(req, res, next) {
    try {
      const data = await eslService.getScheduleStatus(req.params.id);
      res.json(data);
    } catch (error) {
      next(error);
    }
  },

  async getScheduleState(_req, res, next) {
    try {
      const data = await eslService.getScheduleState();
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async bridgeScheduleSync(req, res, next) {
    try {
      const data = await eslService.bridgeScheduleSync(req.body);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async getHeartbeatState(req, res, next) {
    try {
      const data = await eslService.getHeartbeatState(req.params.id);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async getAssignmentState(req, res, next) {
    try {
      const data = await eslService.getAssignmentState(req.params.id);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async bridgeLabelSync(req, res, next) {
    try {
      const data = await eslService.bridgeLabelSync(req.params.id, req.body);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async createDevice(req, res, next) {
    try {
      const data = await eslService.createDevice(req.body);
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async updateDevice(req, res, next) {
    try {
      const data = await eslService.updateDevice(req.params.id, req.body);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async deleteDevice(req, res, next) {
    try {
      const data = await eslService.deleteDevice(req.params.id);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async sendToDevice(req, res, next) {
    try {
      const data = await eslService.sendToDevice(req.body, req.user);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async clearLabel(req, res, next) {
    try {
      const data = await eslService.clearLabel(req.params.id);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async updateBattery(req, res, next) {
    try {
      const data = await eslService.updateBattery(req.params.id, req.body);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async updateHeartbeat(req, res, next) {
    try {
      const data = await eslService.updateHeartbeat(req.params.id, req.body);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async listHistory(req, res, next) {
    try {
      const data = await eslService.listHistory(req.query);
      sendListResponse(res, data);
    } catch (error) {
      next(error);
    }
  },

  async clearHistory(req, res, next) {
    try {
      const data = await eslService.clearHistory();
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async getStats(req, res, next) {
    try {
      const data = await eslService.getStats();
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
};
