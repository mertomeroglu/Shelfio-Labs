import { sectionService } from '../services/sectionService.js';
import { sendListResponse } from '../utils/listResponse.js';

export const sectionController = {
  async list(req, res, next) {
    try {
      const sections = await sectionService.list();
      res.json(sections);
    } catch (error) {
      next(error);
    }
  },

  async getById(req, res, next) {
    try {
      const section = await sectionService.getById(req.params.id);
      res.json(section);
    } catch (error) {
      next(error);
    }
  },

  async getProducts(req, res, next) {
    try {
      const products = await sectionService.getProducts(req.params.id);
      res.json(products);
    } catch (error) {
      next(error);
    }
  },

  async createTransferRequest(req, res, next) {
    try {
      const transferRequest = await sectionService.createTransferRequest(req.params.id, req.body, req.user);
      res.status(201).json(transferRequest);
    } catch (error) {
      next(error);
    }
  },

  async listTransferRequests(req, res, next) {
    try {
      const transferRequests = await sectionService.listTransferRequests(req.query, req.user);
      sendListResponse(res, {
        items: transferRequests,
        pagination: transferRequests?.meta?.pagination,
        filters: transferRequests?.meta?.filters || {},
      });
    } catch (error) {
      next(error);
    }
  },

  async updateTransferRequestStatus(req, res, next) {
    try {
      const transferRequest = await sectionService.updateTransferRequestStatus(req.params.requestId, req.body, req.user);
      res.json(transferRequest);
    } catch (error) {
      next(error);
    }
  },

  async bulkUpdateTransferRequests(req, res, next) {
    try {
      const result = await sectionService.bulkUpdateTransferRequests(req.body || {}, req.user);
      res.json(result);
    } catch (error) {
      next(error);
    }
  },

  async runTransferAutomationScan(req, res, next) {
    try {
      const result = await sectionService.runTransferAutomationScan(req.body || {});
      res.json(result);
    } catch (error) {
      next(error);
    }
  },

  async create(req, res, next) {
    try {
      const section = await sectionService.create(req.body);
      res.status(201).json(section);
    } catch (error) {
      next(error);
    }
  },

  async update(req, res, next) {
    try {
      const section = await sectionService.update(req.params.id, req.body);
      res.json(section);
    } catch (error) {
      next(error);
    }
  },

  async remove(req, res, next) {
    try {
      await sectionService.remove(req.params.id);
      res.json({ message: 'Reyon silindi' });
    } catch (error) {
      next(error);
    }
  },
};
