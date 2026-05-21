function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function normalizeOrderUnit(unit) {
  const normalized = String(unit || '').trim().toLocaleLowerCase('tr-TR').replace(/\s+/g, ' ');
  if (!normalized) return '';
  if (normalized.includes('adet')) return 'adet';
  if (normalized.includes('paket')) return 'paket';
  if (normalized.includes('kutu')) return 'kutu';
  if (normalized.includes('koli')) return 'koli';
  if (normalized.includes('kasa')) return 'kasa';
  if (normalized.includes('çuval') || normalized.includes('cuval')) return 'çuval';
  if (normalized.includes('palet')) return 'palet';
  if (normalized === 'kg' || normalized.includes('kilogram')) return 'kg';
  if (normalized.includes('şişe') || normalized.includes('sise')) return 'şişe';
  return normalized;
}

export function toOrderUnitLabel(unit) {
  const key = normalizeOrderUnit(unit);
  if (!key) return '';
  const known = {
    adet: 'Adet',
    paket: 'Paket',
    kutu: 'Kutu',
    koli: 'Koli',
    kasa: 'Kasa',
    'çuval': 'Çuval',
    palet: 'Palet',
    kg: 'Kg',
    'şişe': 'Şişe',
  };
  if (known[key]) return known[key];
  return key.charAt(0).toLocaleUpperCase('tr-TR') + key.slice(1);
}

export function dedupeOrderUnits(units = []) {
  const source = Array.isArray(units) ? units : [];
  const seen = new Set();
  const result = [];
  source.forEach((item) => {
    const key = normalizeOrderUnit(item);
    if (!key || seen.has(key)) return;
    seen.add(key);
    result.push(key);
  });
  return result;
}

export function getUnitMultipliers(product = {}) {
  const unitsPerCase = Math.max(0, toNumber(product?.unitsPerCase || product?.unitPerCase || 0));
  const unitsPerPackage = Math.max(0, toNumber(product?.unitsPerPackage || product?.unitPerPackage || product?.packageSize || product?.unitsPerPack || product?.packSize || 0));
  const casesPerPallet = Math.max(0, toNumber(product?.casesPerPallet || product?.casePerPallet || 0));
  const unitsPerPalletDirect = Math.max(0, toNumber(product?.unitsPerPallet || product?.unitPerPallet || 0));
  const unitsPerPallet = unitsPerPalletDirect > 0 ? unitsPerPalletDirect : (unitsPerCase > 0 && casesPerPallet > 0 ? unitsPerCase * casesPerPallet : 0);

  return {
    adet: 1,
    paket: unitsPerPackage > 0 ? unitsPerPackage : 1,
    kutu: unitsPerCase > 0 ? unitsPerCase : 1,
    koli: unitsPerCase > 0 ? unitsPerCase : 1,
    kasa: unitsPerCase > 0 ? unitsPerCase : 1,
    'çuval': unitsPerCase > 0 ? unitsPerCase : 1,
    palet: unitsPerPallet > 0 ? unitsPerPallet : 1,
    kg: 1,
    'şişe': 1,
  };
}

export function getOrderableUnits(product = {}) {
  const configured = Array.isArray(product?.orderableUnits) ? product.orderableUnits : [];
  const defaults = [product?.orderUnit, product?.defaultOrderUnit, product?.minOrderUnit, product?.priceUnit, product?.unit, 'adet'];
  return dedupeOrderUnits([...configured, ...defaults]);
}

export function getPrimaryOrderUnit(product = {}) {
  const units = getOrderableUnits(product);
  const normalized = units.map(normalizeOrderUnit);
  if (normalized.some((unit) => unit.includes('koli'))) return 'koli';
  if (normalized.some((unit) => unit.includes('paket'))) return 'paket';
  if (normalized.some((unit) => unit.includes('kg') || unit.includes('kilogram'))) return 'kg';
  if (normalized.some((unit) => unit.includes('palet'))) return 'palet';
  return normalizeOrderUnit(units[0] || 'adet') || 'adet';
}

export function getUnitMultiplier(product = {}, unit = 'adet') {
  const key = normalizeOrderUnit(unit);
  const map = getUnitMultipliers(product);
  if (key.includes('koli')) return Math.max(1, map.koli);
  if (key.includes('paket')) return Math.max(1, map.paket);
  if (key.includes('kutu')) return Math.max(1, map.kutu);
  if (key.includes('kasa')) return Math.max(1, map.kasa);
  if (key.includes('çuval')) return Math.max(1, map['çuval']);
  if (key.includes('palet')) return Math.max(1, map.palet);
  if (key.includes('kg') || key.includes('kilogram')) return 1;
  return 1;
}

export function formatRecommendedOrderByUnit(product = {}, baseQty = 0, preferredUnit = '') {
  const unit = normalizeOrderUnit(preferredUnit || getPrimaryOrderUnit(product) || 'adet');
  const multiplier = Math.max(1, getUnitMultiplier(product, unit));
  const raw = Math.max(0, Number(baseQty || 0)) / multiplier;
  if (!Number.isFinite(raw) || raw <= 0) return { value: 0, unit, text: `0 ${unit}` };
  const rounded = unit === 'kg' ? Number(raw.toFixed(1)) : Math.max(1, Math.round(raw));
  return { value: rounded, unit, text: `${rounded} ${unit}` };
}
