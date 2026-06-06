const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export const normalizeDateOnly = (value) => {
  const text = String(value || '').trim();
  if (!text) return '';
  if (DATE_ONLY_PATTERN.test(text)) return text.slice(0, 10);
  const parsed = new Date(text);
  if (!Number.isFinite(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
};

export const isBatchExpired = (batch = {}, { now = new Date() } = {}) => {
  const skt = normalizeDateOnly(batch?.skt || batch?.expiryDate || batch?.expirationDate);
  if (!skt) return false;
  const today = normalizeDateOnly(now);
  return Boolean(today && skt < today);
};

export const getBatchSellableQuantity = (batch = {}, options = {}) => {
  const totalQuantity = Math.max(0, Number(batch?.totalQuantity ?? 0) || 0);
  return isBatchExpired(batch, options) ? 0 : totalQuantity;
};

export const summarizeBatchAvailability = (batches = [], { reserved = 0, now = new Date() } = {}) => {
  const normalizedBatches = Array.isArray(batches) ? batches : [];
  const sellableQuantity = normalizedBatches.reduce((sum, batch) => sum + getBatchSellableQuantity(batch, { now }), 0);
  const expiredQuantity = normalizedBatches.reduce((sum, batch) => {
    if (!isBatchExpired(batch, { now })) return sum;
    return sum + Math.max(0, Number(batch?.totalQuantity ?? 0) || 0);
  }, 0);
  return {
    sellableQuantity,
    expiredQuantity,
    available: Math.max(0, sellableQuantity - Math.max(0, Number(reserved || 0) || 0)),
  };
};

export const enrichBatchExpiryState = (batch = {}, options = {}) => {
  const expired = isBatchExpired(batch, options);
  const totalQuantity = Math.max(0, Number(batch?.totalQuantity ?? 0) || 0);
  return {
    ...batch,
    isExpired: expired,
    isSellable: totalQuantity > 0 && !expired,
    sellableQuantity: expired ? 0 : totalQuantity,
    riskStatus: expired && totalQuantity > 0 ? 'SKT gecmis' : batch?.riskStatus || '',
    status: expired && totalQuantity > 0 ? 'SKT gecmis' : (batch?.status || (totalQuantity > 0 ? 'Aktif' : 'Tukendi')),
  };
};
