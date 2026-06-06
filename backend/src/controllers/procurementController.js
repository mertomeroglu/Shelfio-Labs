import { procurementService } from '../services/procurementService.js';
import { catalogImportService } from '../services/catalogImportService.js';
import { sendListResponse } from '../utils/listResponse.js';

export const procurementController = {
  async listLogisticsTariffs(req, res, next) {
    try {
      const data = await procurementService.listLogisticsTariffs(req.query || {});
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async getLogisticsQuote(req, res, next) {
    try {
      const data = await procurementService.getLogisticsQuote(req.body || {});
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async listSupplierProducts(req, res, next) {
    try {
      const data = await procurementService.listSupplierProducts(req.query);
      sendListResponse(res, data);
    } catch (error) {
      next(error);
    }
  },

  async createSupplierProduct(req, res, next) {
    try {
      const data = await procurementService.createSupplierProduct(req.body);
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async updateSupplierProduct(req, res, next) {
    try {
      const data = await procurementService.updateSupplierProduct(req.params.id, req.body);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async removeSupplierProduct(req, res, next) {
    try {
      const data = await procurementService.removeSupplierProduct(req.params.id);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async generateSuggestions(req, res, next) {
    try {
      const data = await procurementService.generateSuggestions(req.body || {}, req.user || {});
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async listSuggestions(req, res, next) {
    try {
      const result = await procurementService.listSuggestions(req.query);
      if (result?.items && result?.pagination) {
        res.json({
          success: true,
          data: result.items,
          total: result.pagination.total,
          page: result.pagination.page,
          limit: result.pagination.limit,
          meta: {
            pagination: result.pagination,
            filters: result.filters || {},
            sort: result.sort || {},
            summary: result.summary || null,
          },
        });
        return;
      }
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },

  async getSuggestionSummary(req, res, next) {
    try {
      const data = await procurementService.getSuggestionSummary(req.query);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async updateSuggestion(req, res, next) {
    try {
      const data = await procurementService.updateSuggestion(req.params.id, req.body, req.user.id);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async approveSuggestion(req, res, next) {
    try {
      const data = await procurementService.approveSuggestion(req.params.id, req.body, req.user.id);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async rejectSuggestion(req, res, next) {
    try {
      const data = await procurementService.rejectSuggestion(req.params.id, req.user.id);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async listOrders(req, res, next) {
    try {
      const result = await procurementService.listOrders(req.query);
      sendListResponse(res, result);
    } catch (error) {
      next(error);
    }
  },

  async listOrderItems(req, res, next) {
    try {
      const data = await procurementService.listOrderItems(req.params.id);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async createOrder(req, res, next) {
    try {
      const data = await procurementService.createOrderFromSupplierProduct(req.body, req.user.id);
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async updateOrderStatus(req, res, next) {
    try {
      const data = await procurementService.updateOrderStatus(req.params.id, req.body, req.user.id);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async listCatalogImports(req, res, next) {
    try {
      const data = await catalogImportService.listImports(req.query || {});
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async listCatalogApprovalQueue(req, res, next) {
    try {
      const data = await catalogImportService.listApprovalQueue(req.query || {});
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async matchCatalogApprovalQueueRow(req, res, next) {
    try {
      const data = await catalogImportService.matchApprovalQueueRow(req.params.rowId, req.body || {}, req.user || {});
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async createCatalogApprovalQueueDraft(req, res, next) {
    try {
      const data = await catalogImportService.createApprovalQueueDraft(req.params.rowId, req.body || {}, req.user || {});
      res.status(201).json({
        success: true,
        message: data?.message || 'Ürün taslağı oluşturuldu.',
        draftProductId: data?.draftProductId || data?.product?.id || null,
        data,
      });
    } catch (error) {
      next(error);
    }
  },

  async rejectCatalogApprovalQueueRow(req, res, next) {
    try {
      const data = await catalogImportService.rejectApprovalQueueRow(req.params.rowId, req.body || {}, req.user || {});
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async undoCatalogApprovalQueueDecision(req, res, next) {
    try {
      const data = await catalogImportService.undoApprovalQueueDecision(req.params.rowId, req.body || {}, req.user || {});
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async previewCatalogImport(req, res, next) {
    try {
      const data = await catalogImportService.previewImport(req.body || {}, req.user || {});
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async updateCatalogImportRow(req, res, next) {
    try {
      const data = await catalogImportService.updateImportRow(req.params.id, req.params.rowId, req.body || {});
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async commitCatalogImport(req, res, next) {
    try {
      const data = await catalogImportService.commitImport(req.params.id, req.body || {}, req.user || {});
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async listCatalogVersions(req, res, next) {
    try {
      const data = await catalogImportService.listCatalogVersions(req.query || {});
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async getCatalogVersionRows(req, res, next) {
    try {
      const data = await catalogImportService.getCatalogVersionRows(req.params.versionId);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async activateCatalogVersion(req, res, next) {
    try {
      const data = await catalogImportService.activateVersion(req.params.versionId, req.user || {});
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
};
