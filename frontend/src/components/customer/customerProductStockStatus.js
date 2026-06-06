function toFiniteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatDetailDate(value) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function collectStockCandidates(product = {}, stockForecast = null) {
  const stockSummary = product?.stockSummary && typeof product.stockSummary === 'object'
    ? product.stockSummary
    : {};
  const shelfWarehouseSum = [product?.shelfStock, product?.warehouseStock]
    .map(toFiniteNumber)
    .reduce((sum, value) => (value === null ? sum : sum + value), 0);
  const hasShelfWarehouseValues = [product?.shelfStock, product?.warehouseStock].some((value) => toFiniteNumber(value) !== null);

  return [
    stockForecast?.availableStock,
    product?.availableStock,
    product?.available,
    stockSummary?.available,
    product?.currentStock,
    product?.totalStock,
    product?.onHand,
    stockSummary?.onHand,
    product?.stock,
    product?.quantity,
    hasShelfWarehouseValues ? shelfWarehouseSum : null,
  ];
}

export function resolveCanonicalAvailableStock(product = {}, stockForecast = null) {
  const resolved = collectStockCandidates(product, stockForecast)
    .map(toFiniteNumber)
    .find((value) => value !== null);
  return resolved ?? 0;
}

export function resolveCustomerProductStockPresentation({
  product = {},
  stockForecast = null,
  stockForecastLoading = false,
  stockForecastError = false,
} = {}) {
  const fallbackForecast = product.customerStockForecast || product.productDetailView?.customerStockForecast || {};
  const activeForecast = stockForecast && typeof stockForecast === 'object' ? stockForecast : fallbackForecast;
  const canonicalAvailableStock = resolveCanonicalAvailableStock(product, stockForecast);
  const inStore = canonicalAvailableStock > 0;
  const estimatedStockoutDate = formatDetailDate(activeForecast.estimatedStockoutDate);
  const lastReplenishedDate = formatDetailDate(activeForecast.lastReplenishedAt || fallbackForecast.lastReplenishedAt);

  let estimatedStockoutLabel = 'Tahmin için yeterli satış verisi yok';
  if (!inStore) {
    estimatedStockoutLabel = 'Stokta yok';
  } else if (stockForecastLoading) {
    estimatedStockoutLabel = 'Hesaplanıyor...';
  } else if (stockForecastError) {
    estimatedStockoutLabel = 'Tahmin alınamadı';
  } else if (estimatedStockoutDate) {
    estimatedStockoutLabel = estimatedStockoutDate;
  } else if (activeForecast.reason === 'Stok uzun süre yeterli görünüyor') {
    estimatedStockoutLabel = 'Uzun süre yeterli';
  } else if (
    activeForecast.reason
    && activeForecast.reason !== 'Stokta yok'
    && activeForecast.reason !== 'Tahmin için yeterli satış verisi yok'
  ) {
    estimatedStockoutLabel = activeForecast.reason;
  }

  return {
    canonicalAvailableStock,
    inStore,
    stockStatusLabel: inStore ? 'Mağazada mevcut' : 'Stokta yok',
    stockStatusClassName: inStore ? 'is-ok' : 'is-bad',
    estimatedStockoutLabel,
    replenishmentLabel: lastReplenishedDate || 'Son 30 gün içinde yenilendi',
  };
}
