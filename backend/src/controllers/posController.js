import { posService } from '../services/posService.js';

export const posController = {
  async getDeskActivationStatus(req, res, next) {
    try {
      const data = await posService.getDeskActivationStatus();
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async getAutomaticSaleAvailability(req, res, next) {
    try {
      const data = await posService.getAutomaticSaleAvailability();
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async setDeskActivation(req, res, next) {
    try {
      const data = await posService.setDeskActivation(req.body, req.user);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async getDashboard(req, res, next) {
    try {
      const data = await posService.getDashboard();
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async getCategories(req, res, next) {
    try {
      const data = await posService.getCategories();
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async getProductsByCategory(req, res, next) {
    try {
      const data = await posService.getProductsByCategory(req.params.categoryId);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async searchProducts(req, res, next) {
    try {
      const data = await posService.searchProducts(req.query.q);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async findByBarcode(req, res, next) {
    try {
      const data = await posService.findProductByBarcode(req.params.barcode);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async completeSale(req, res, next) {
    try {
      const data = await posService.completeSale(req.body, req.user);
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async lookupMobileOrder(req, res, next) {
    try {
      const data = await posService.lookupMobileOrder(req.body || {}, req.user);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async pullMobileOrder(req, res, next) {
    try {
      const data = await posService.pullMobileOrder(req.params.id, req.user);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async completeMobileOrder(req, res, next) {
    try {
      const data = await posService.completeMobileOrder(req.params.id, req.body || {}, req.user);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async createAutomaticSale(req, res, next) {
    try {
      const data = await posService.createAutomaticSale(req.body, req.user);
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async getAutomaticPanelTransactions(req, res, next) {
    try {
      const data = await posService.getAutomaticPanelTransactions(req.query.limit);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async processReturn(req, res, next) {
    try {
      const data = await posService.processReturn(req.body, req.user);
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async getTodaySales(req, res, next) {
    try {
      const data = await posService.getTodaySales();
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async getSaleById(req, res, next) {
    try {
      const data = await posService.getSaleById(req.params.id);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async getSaleByReference(req, res, next) {
    try {
      const data = await posService.getSaleByReference(req.params.ref);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async getAllSales(req, res, next) {
    try {
      const data = await posService.getAllSales(req.query);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async getDailyReport(req, res, next) {
    try {
      const data = await posService.getDailyReport(req.query.date);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async listDayEndClosings(req, res, next) {
    try {
      const data = await posService.listDayEndClosings(req.query);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async closeDayEnd(req, res, next) {
    try {
      const data = await posService.closeDayEnd(req.body, req.user);
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
};
