import { resolveSktPolicy, SKT_POLICIES } from '../utils/sktPolicy.js';

const logIntegrityIssue = (message, details = {}) => {
  console.warn('[Veri bütünlüğü]', message, details);
};

const normalizeDateOnly = (value) => {
  const text = String(value || '').trim();
  if (!text) return '';
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
};

export const validateCampaignLifecycleIntegrity = (campaigns = [], { now = new Date() } = {}) => {
  const nowMs = now.getTime();
  for (const campaign of campaigns) {
    if (!campaign?.id) {
      logIntegrityIssue('Kimliği olmayan kampanya kaydı atlandı', { campaignName: campaign?.name || '' });
      continue;
    }
    if (!campaign.name) {
      logIntegrityIssue('Adı olmayan kampanya kaydı tespit edildi', { campaignId: campaign.id });
    }
    if (campaign.endsAtDate && campaign.endsAtDate.getTime() < nowMs && campaign.isCurrentlyActive) {
      logIntegrityIssue('Bitiş tarihi geçmiş kampanya aktif projeksiyona girmiş görünüyor', {
        campaignId: campaign.id,
        campaignName: campaign.name,
        endsAt: campaign.endsAt,
      });
    }
  }
};

export const validateBatchSktIntegrity = (batches = [], { productId = '', productName = '' } = {}) => {
  const seen = new Map();
  for (const batch of Array.isArray(batches) ? batches : []) {
    const batchNo = String(batch?.batchNo || '').trim();
    const skt = normalizeDateOnly(batch?.skt);
    const totalQuantity = Number(batch?.totalQuantity || 0);
    if (totalQuantity <= 0) continue;
    if (!batchNo) {
      logIntegrityIssue('Aktif stoklu batch için Parti No eksik', { productId, productName });
    }
    if (!skt) {
      logIntegrityIssue('Aktif stoklu batch için SKT eksik veya geçersiz', { productId, productName, batchNo });
    }
    if (batchNo && seen.has(batchNo) && seen.get(batchNo) !== skt) {
      logIntegrityIssue('Aynı Parti No farklı SKT ile görünüyor', {
        productId,
        productName,
        batchNo,
        firstSkt: seen.get(batchNo),
        currentSkt: skt,
      });
    }
    if (batchNo) seen.set(batchNo, skt);
  }
};

export const validateStockBatchSummaryIntegrity = (stock = {}, { product = {} } = {}) => {
  const batches = Array.isArray(stock.batches) ? stock.batches : [];
  const sktPolicy = resolveSktPolicy({ product, category: product.category || null });
  if (sktPolicy.policy === SKT_POLICIES.REQUIRED) {
    validateBatchSktIntegrity(batches, { productId: stock.productId || product.id, productName: product.name });
  }
  const batchTotal = batches.reduce((sum, batch) => sum + Number(batch?.totalQuantity || 0), 0);
  const stockTotal = Number(stock.warehouseQuantity || 0) + Number(stock.shelfQuantity || 0);
  if (batchTotal !== stockTotal) {
    logIntegrityIssue('Ürün stok toplamı ile batch toplamı uyuşmuyor', {
      productId: stock.productId || product.id,
      productName: product.name || '',
      stockTotal,
      batchTotal,
    });
  }
};
