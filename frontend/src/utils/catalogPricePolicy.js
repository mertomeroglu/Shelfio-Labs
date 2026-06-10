export const toFinitePrice = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const evaluateCatalogPriceChange = ({ oldPrice, newPrice }) => {
  const oldValue = toFinitePrice(oldPrice);
  const newValue = toFinitePrice(newPrice);

  if (
    newValue === null
    || newValue <= 0
    || (oldPrice !== null && oldPrice !== undefined && (oldValue === null || oldValue <= 0))
  ) {
    return {
      difference: null,
      changePct: null,
      status: 'invalid',
      riskLevel: 'invalid',
      priceAnomalyReason: 'invalid_price',
      requiresManualReview: true,
      canAutoApprove: false,
    };
  }

  if (oldPrice === null || oldPrice === undefined) {
    return {
      difference: null,
      changePct: null,
      status: 'new_product',
      riskLevel: 'normal',
      priceAnomalyReason: null,
      requiresManualReview: false,
      canAutoApprove: true,
    };
  }

  const difference = newValue - oldValue;
  const changePct = (difference / oldValue) * 100;
  const absoluteChange = Math.abs(changePct);
  const isScaleAnomaly = changePct > 300 || changePct < -50;
  const requiresManualReview = !isScaleAnomaly && absoluteChange > 60;

  return {
    difference,
    changePct,
    status:
      isScaleAnomaly
        ? 'invalid'
        : absoluteChange <= 1
          ? 'unchanged'
          : changePct > 0
            ? 'increase'
            : 'discount',
    riskLevel:
      isScaleAnomaly
        ? 'invalid'
        : absoluteChange > 60
          ? 'manual_review'
          : absoluteChange > 30
            ? 'high_attention'
            : absoluteChange > 1
              ? 'normal'
              : 'insignificant',
    priceAnomalyReason: isScaleAnomaly ? 'price_scale_suspected' : null,
    requiresManualReview,
    canAutoApprove: !isScaleAnomaly && !requiresManualReview,
  };
};

const BLOCKING_STATUSES = new Set([
  'Hatalı',
  'Eşleşme Gerekli',
  'Fiyat Kontrolü Gerekli',
  'Para Birimi Kontrolü Gerekli',
  'KDV Bazı Kontrolü Gerekli',
  'Manuel İnceleme',
]);

const BLOCKING_DIFF_STATUSES = new Set([
  'invalid_row',
  'ambiguous_match',
  'price_review_required',
  'currency_review_required',
  'vat_review_required',
]);

export const hasBlockingCatalogRows = (rows = []) =>
  rows.some(
    (row) =>
      BLOCKING_STATUSES.has(row?.status)
      || BLOCKING_DIFF_STATUSES.has(row?.diffStatus)
      || row?.priceAnomalyReason
      || row?.requiresManualReview
      || (Array.isArray(row?.errors) && row.errors.length > 0),
  );
