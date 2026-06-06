const normalizeString = (value) => String(value || '').trim();

export const normalizeProcurementUnit = (value) => {
  const raw = normalizeString(value).toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ');
  if (!raw) return '';
  if (raw.includes('adet') || raw === 'unit') return 'adet';
  if (raw.includes('paket') || raw === 'pack') return 'paket';
  if (raw.includes('kutu') || raw === 'box') return 'kutu';
  if (raw.includes('koli') || raw === 'case') return 'koli';
  if (raw.includes('kasa')) return 'kasa';
  if (raw.includes('çuval') || raw.includes('cuval') || raw === 'sack') return 'çuval';
  if (raw.includes('palet') || raw === 'pallet') return 'palet';
  if (raw === 'kg' || raw.includes('kilogram')) return 'kg';
  if (raw.includes('şişe') || raw.includes('sise') || raw === 'bottle') return 'şişe';
  return raw;
};

export const dedupeProcurementUnits = (units = []) => {
  const seen = new Set();
  const result = [];
  (Array.isArray(units) ? units : []).forEach((unit) => {
    const key = normalizeProcurementUnit(unit);
    if (!key || seen.has(key)) return;
    seen.add(key);
    result.push(key);
  });
  return result;
};

export const resolveSupplierProductOrderableUnits = (supplierProduct = {}, product = {}) => {
  const payload = supplierProduct?.payload && typeof supplierProduct.payload === 'object'
    ? supplierProduct.payload
    : {};
  const explicit = Array.isArray(supplierProduct.orderableUnits)
    ? supplierProduct.orderableUnits
    : Array.isArray(payload.orderableUnits)
      ? payload.orderableUnits
      : [];

  const mappingUnits = [
    supplierProduct.defaultOrderUnit,
    supplierProduct.minOrderUnit,
    supplierProduct.priceUnit,
    supplierProduct.orderUnit,
  ];

  const productFallbackUnits = explicit.length
    ? []
    : [product.defaultOrderUnit, product.orderUnit, product.unit];

  const resolved = dedupeProcurementUnits([...explicit, ...mappingUnits, ...productFallbackUnits]);
  return resolved.length ? resolved : ['adet'];
};

export const assertValidSupplierProductOrderUnit = ({ supplierProduct = {}, product = {}, unit = '' } = {}) => {
  const normalized = normalizeProcurementUnit(unit);
  const allowed = resolveSupplierProductOrderableUnits(supplierProduct, product);
  return {
    normalized,
    allowed,
    isValid: Boolean(normalized && allowed.includes(normalized)),
  };
};
