import { productService } from '../services/productService.js';
import { sendListResponse } from '../utils/listResponse.js';

const PRODUCT_SORT_ALIASES = {
  updated_at_desc: 'updated_at_desc',
  updatedAt_desc: 'updated_at_desc',
  'updatedAt:desc': 'updated_at_desc',
  'updatedAt.desc': 'updated_at_desc',
  '-updatedAt': 'updated_at_desc',
  updated_at_asc: 'updated_at_asc',
  updatedAt_asc: 'updated_at_asc',
  'updatedAt:asc': 'updated_at_asc',
  'updatedAt.asc': 'updated_at_asc',
  salePrice_desc: 'sale_price_desc',
  salePrice_asc: 'sale_price_asc',
  purchasePrice_desc: 'purchase_price_desc',
  purchasePrice_asc: 'purchase_price_asc',
  lastPriceChangeAt_desc: 'last_price_change_at_desc',
  lastPriceChangeAt_asc: 'last_price_change_at_asc',
};

const parseIncludeGeneralCampaigns = (value) => !['0', 'false', 'no'].includes(String(value ?? '').trim().toLowerCase());

function normalizeProductSort(value) {
  const raw = String(value || '').trim();
  if (!raw) return raw;
  return PRODUCT_SORT_ALIASES[raw] || raw;
}

export const productController = {
  async list(req, res, next) {
    try {
      const includeUnlisted = ['1', 'true', 'yes'].includes(String(req.query?.includeUnlisted || '').toLowerCase());
      const result = await productService.list({
        includeUnlisted,
        universe: req.query?.universe || (includeUnlisted ? undefined : 'listed_active'),
        search: req.query?.search || req.query?.q,
        page: req.query?.page,
        limit: req.query?.limit,
        cursor: req.query?.cursor,
        paginationMode: req.query?.paginationMode || req.query?.mode,
        includeTotal: req.query?.includeTotal,
        sort: normalizeProductSort(req.query?.sort),
        categoryId: req.query?.categoryId,
        supplierId: req.query?.supplierId,
        supplierSearch: req.query?.supplierSearch,
        sectionId: req.query?.sectionId,
        listed: req.query?.listed,
        status: req.query?.status,
        includeDrafts: req.query?.includeDrafts,
        catalogVisibility: req.query?.catalogVisibility,
        sourceReadModel: req.query?.sourceReadModel,
        completionStatus: req.query?.completionStatus,
        tag: req.query?.tag,
        etiket: req.query?.etiket,
        campaignOnly: req.query?.campaignOnly || req.query?.discountOnly || req.query?.hasCampaign,
        includeCampaignDetails: req.query?.includeCampaignDetails === 'true' || req.query?.includeCampaignDetails === '1',
        includeGeneralCampaigns: parseIncludeGeneralCampaigns(req.query?.includeGeneralCampaigns),
        includeListDetails: req.query?.includeListDetails === 'true' || req.query?.includeListDetails === '1',
      });
      sendListResponse(res, result);
    } catch (error) {
      next(error);
    }
  },

  async getById(req, res, next) {
    try {
      const data = await productService.getById(req.params.id);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async create(req, res, next) {
    try {
      const data = await productService.create(req.body);
      res.status(201).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async update(req, res, next) {
    try {
      const data = await productService.update(req.params.id, req.body);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async remove(req, res, next) {
    try {
      const data = await productService.remove(req.params.id);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  async findByBarcode(req, res, next) {
    try {
      const includeUnlisted = ['1', 'true', 'yes'].includes(String(req.query?.includeUnlisted || '').toLowerCase());
      const data = await productService.findByBarcode(req.params.barcode, {
        includeUnlisted,
        universe: req.query?.universe || (includeUnlisted ? undefined : 'listed_active'),
      });
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },
};
