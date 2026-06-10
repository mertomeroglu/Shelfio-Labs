const PACKAGED_UNITS = new Set(['koli', 'kasa', 'paket', 'çuval', 'cuval']);

export const PURCHASE_SUGGESTION_REASON_TEXT = Object.freeze({
  product_inactive: 'Ürün pasif olduğu için öneriye alınmadı',
  missing_supplier_mapping: 'Tedarikçi eşleşmesi olmadığı için otomatik öneri oluşturulmadı',
  inactive_supplier: 'Tedarikçi pasif olduğu için öneri oluşturulmadı',
  missing_min_stock: 'Minimum veya kritik stok seviyesi tanımlanmadığı için otomatik öneri oluşturulmadı',
  missing_lead_time: 'Tedarik süresi tanımlanmadığı için otomatik öneri oluşturulmadı',
  inbound_covered: 'Yoldaki sipariş mevcut ihtiyacı karşılıyor',
  slow_sales: 'Satış hızı düşük, manuel değerlendirme önerilir',
  stockout_high_demand: 'Stok bitti ve satış hızı yüksek',
  below_reorder_point: 'Stok seviyesi sipariş eşiğinin altında',
  missing_demand_data: 'Yeterli satış verisi olmadığı için otomatik öneri oluşturulmadı',
  missing_moq_or_case_data: 'MOQ veya koli bilgisi eksik olduğu için otomatik öneri oluşturulamadı',
  stock_sufficient: 'Mevcut stok seviyesi sipariş gerektirmiyor',
  mode_or_risk_guard: 'Seçilen üretim modu için risk seviyesi yeterli değil',
});

const result = (status, reasonTag) => ({
  status,
  reasonTag,
  reasonText: PURCHASE_SUGGESTION_REASON_TEXT[reasonTag],
});

export const hasRequiredOrderData = ({
  minimumOrderQty,
  minimumOrderUnit,
  unitsPerCase,
} = {}) => {
  const minimum = Number(minimumOrderQty);
  if (!Number.isFinite(minimum) || minimum <= 0) return false;

  const unit = String(minimumOrderUnit || 'adet').trim().toLocaleLowerCase('tr-TR');
  if (!PACKAGED_UNITS.has(unit)) return true;

  const caseSize = Number(unitsPerCase);
  return Number.isFinite(caseSize) && caseSize > 0;
};

export const decidePurchaseSuggestion = ({
  productActive = true,
  supplierMappingExists = false,
  activeSupplierMappingExists = false,
  minimumStockAvailable = true,
  leadTimeAvailable = true,
  orderDataComplete = false,
  demandDataAvailable = false,
  inboundCoversNeed = false,
  currentStock = 0,
  reorderPoint = 0,
  salesSpeed = 'slow',
  sold30 = 0,
} = {}) => {
  if (!productActive) return result('skipped', 'product_inactive');
  if (!supplierMappingExists) return result('skipped', 'missing_supplier_mapping');
  if (!activeSupplierMappingExists) return result('skipped', 'inactive_supplier');
  if (!minimumStockAvailable) return result('skipped', 'missing_min_stock');
  if (!leadTimeAvailable) return result('skipped', 'missing_lead_time');
  if (!orderDataComplete) return result('skipped', 'missing_moq_or_case_data');
  if (!demandDataAvailable) return result('skipped', 'missing_demand_data');
  if (inboundCoversNeed) return result('skipped', 'inbound_covered');

  const stock = Math.max(0, Number(currentStock) || 0);
  const threshold = Math.max(0, Number(reorderPoint) || 0);
  const demand = Math.max(0, Number(sold30) || 0);
  const speed = String(salesSpeed || '').trim().toLowerCase();

  if (stock === 0) {
    if (speed === 'slow' || demand <= 0) return result('manual_evaluation', 'slow_sales');
    return result('pending', 'stockout_high_demand');
  }

  if (stock < threshold) return result('pending', 'below_reorder_point');
  return result('skipped', 'stock_sufficient');
};
