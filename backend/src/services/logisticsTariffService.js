import { AppError } from '../utils/appError.js';

const normalizeString = (value) => String(value || '').trim();
const hasValue = (value) => value !== undefined && value !== null && value !== '';

const toNumberOrNull = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const toPositiveNumberOrNull = (value) => {
  const parsed = toNumberOrNull(value);
  if (parsed === null) return null;
  return parsed > 0 ? parsed : null;
};

const CASE_BANDS = [
  { caseQtyMin: 1, caseQtyMax: 5 },
  { caseQtyMin: 6, caseQtyMax: 10 },
  { caseQtyMin: 11, caseQtyMax: 20 },
  { caseQtyMin: 21, caseQtyMax: 30 },
  { caseQtyMin: 31, caseQtyMax: 50 },
  { caseQtyMin: 51, caseQtyMax: null },
];

const CASE_TARIFF_BLUEPRINTS = [
  {
    cargoTypeCode: 'standard_intercity',
    cargoTypeName: 'Standart Şehirlerarası',
    deliveryTarget: '1-3 gün',
    storageCompatibility: 'ambient',
    distanceType: 'intercity',
    notes: 'Standart şehirlerarası tarife',
    isColdChain: false,
    isFrozenChain: false,
    isInternalTransfer: false,
    prices: [325, 475, 725, 1075, 1600, 1600],
    incrementalPricePerCase: 35,
  },
  {
    cargoTypeCode: 'express_next_day',
    cargoTypeName: 'Hızlı / Ertesi Gün',
    deliveryTarget: '1 gün',
    storageCompatibility: 'ambient',
    distanceType: 'intercity',
    notes: '',
    isColdChain: false,
    isFrozenChain: false,
    isInternalTransfer: false,
    prices: [475, 700, 1050, 1550, 2300, 2300],
    incrementalPricePerCase: 47.5,
  },
  {
    cargoTypeCode: 'cold_chain',
    cargoTypeName: 'Soğuk Zincir',
    deliveryTarget: '1 gün',
    storageCompatibility: 'cold,frozen',
    distanceType: 'intercity',
    notes: '+0/+4°C ürünler',
    isColdChain: true,
    isFrozenChain: false,
    isInternalTransfer: false,
    prices: [800, 1150, 1700, 2475, 3600, 3600],
    incrementalPricePerCase: 75,
  },
  {
    cargoTypeCode: 'frozen_chain',
    cargoTypeName: 'Donuk Zincir',
    deliveryTarget: '1 gün',
    storageCompatibility: 'frozen',
    distanceType: 'intercity',
    notes: 'Dondurucu ürünler',
    isColdChain: false,
    isFrozenChain: true,
    isInternalTransfer: false,
    prices: [950, 1400, 2050, 3000, 4300, 4300],
    incrementalPricePerCase: 92.5,
  },
  {
    cargoTypeCode: 'store_transfer',
    cargoTypeName: 'Mağaza / Depo Transfer',
    deliveryTarget: 'Aynı gün - 1 gün',
    storageCompatibility: 'internal',
    distanceType: 'internal_transfer',
    notes: 'İç transfer / mağaza besleme / kısa mesafe',
    isColdChain: false,
    isFrozenChain: false,
    isInternalTransfer: true,
    prices: [175, 275, 425, 625, 925, 925],
    incrementalPricePerCase: 22.5,
  },
];

const buildDefaultCaseTariffs = () => CASE_TARIFF_BLUEPRINTS.flatMap((blueprint) => (
  CASE_BANDS.map((band, index) => {
    const bandSuffix = band.caseQtyMax === null ? '51-plus' : `${band.caseQtyMin}-${band.caseQtyMax}`;
    const isTopBand = band.caseQtyMax === null;
    return {
      id: `cargo-${blueprint.cargoTypeCode}-${bandSuffix}`,
      cargoTypeCode: blueprint.cargoTypeCode,
      cargoTypeName: blueprint.cargoTypeName,
      deliveryTarget: blueprint.deliveryTarget,
      storageCompatibility: blueprint.storageCompatibility,
      distanceType: blueprint.distanceType,
      pricingUnit: 'case',
      caseQtyMin: band.caseQtyMin,
      caseQtyMax: band.caseQtyMax,
      basePriceTl: blueprint.prices[index],
      incrementalPricePerCase: isTopBand ? blueprint.incrementalPricePerCase : null,
      isColdChain: blueprint.isColdChain,
      isFrozenChain: blueprint.isFrozenChain,
      isInternalTransfer: blueprint.isInternalTransfer,
      isActive: true,
      notes: isTopBand
        ? `${band.caseQtyMin}+ kolide koli başına ek ücret uygulanır`
        : blueprint.notes,
      desiMin: null,
      desiMax: null,
      incrementalPricePerDesi: null,
    };
  })
));

const normalizeStorageType = (value) => {
  const raw = normalizeString(value).toLocaleLowerCase('tr-TR');
  if (!raw) return 'ambient';
  if (raw.includes('internal')) return 'internal';
  if (raw.includes('frozen') || raw.includes('freezer') || raw.includes('donuk') || raw.includes('dondur')) return 'frozen';
  if (raw.includes('cold') || raw.includes('soğuk') || raw.includes('soguk')) return 'cold';
  if (raw.includes('ambient') || raw.includes('ortam')) return 'ambient';
  return 'ambient';
};

const normalizeDistanceType = (value, isInternalTransfer = false) => {
  const raw = normalizeString(value).toLowerCase();
  if (isInternalTransfer || raw === 'internal_transfer') return 'internal_transfer';
  return 'intercity';
};

const normalizeStorageCompatibility = (value) => (
  normalizeString(value)
    .split(',')
    .map((item) => normalizeStorageType(item))
    .filter(Boolean)
);

const normalizeOrderUnit = (value) => {
  const raw = normalizeString(value).toLocaleLowerCase('tr-TR');
  if (!raw) return 'adet';
  return raw;
};

const estimateCaseQtyFromLine = (line = {}) => {
  const qty = toPositiveNumberOrNull(line.quantity);
  if (qty === null) {
    return { caseQty: null, issue: 'Miktar bilgisi eksik.' };
  }

  const orderUnit = normalizeOrderUnit(line.orderUnit || line.unit);
  if (orderUnit === 'koli') {
    return { caseQty: Math.ceil(qty), issue: null };
  }

  const unitsPerCase = toPositiveNumberOrNull(line.unitsPerCase);
  if (unitsPerCase === null) {
    return { caseQty: null, issue: 'Koli hesabı için case pack (unitsPerCase) eksik.' };
  }

  return { caseQty: Math.ceil(qty / unitsPerCase), issue: null };
};

const deriveStorageContext = ({ storageType, storageTypes, lineItems = [] } = {}) => {
  const list = [];
  if (Array.isArray(storageTypes)) {
    storageTypes.forEach((item) => list.push(normalizeStorageType(item)));
  }
  if (hasValue(storageType)) {
    list.push(normalizeStorageType(storageType));
  }
  lineItems.forEach((line) => {
    if (hasValue(line?.storageType)) {
      list.push(normalizeStorageType(line.storageType));
    } else if (hasValue(line?.requiredStorageType)) {
      list.push(normalizeStorageType(line.requiredStorageType));
    }
  });

  const filtered = list.filter(Boolean);
  const unique = Array.from(new Set(filtered));
  if (!unique.length) {
    return {
      normalizedStorageType: 'ambient',
      storageTypes: ['ambient'],
      isMixedStorage: false,
      mixedStoragePolicy: 'single_storage',
      mixedStorageMessage: null,
    };
  }

  const hasInternal = unique.includes('internal');
  if (hasInternal && unique.length > 1) {
    throw new AppError(400, 'İç transfer ve dış sevkiyat ürünleri aynı siparişte birlikte fiyatlanamaz. Siparişi bölün.');
  }

  let strictest = 'ambient';
  if (unique.includes('internal')) {
    strictest = 'internal';
  } else if (unique.includes('frozen')) {
    strictest = 'frozen';
  } else if (unique.includes('cold')) {
    strictest = 'cold';
  }

  const isMixedStorage = unique.length > 1;
  return {
    normalizedStorageType: strictest,
    storageTypes: unique,
    isMixedStorage,
    mixedStoragePolicy: isMixedStorage ? 'strictest_storage_applied' : 'single_storage',
    mixedStorageMessage: isMixedStorage
      ? `Karma saklama tipi tespit edildi (${unique.join(', ')}). En sıkı kural (${strictest}) uygulandı.`
      : null,
  };
};

const normalizeTariffRow = (row = {}, index = 0) => {
  const caseQtyMinRaw = toPositiveNumberOrNull(row.caseQtyMin);
  const caseQtyMaxRaw = toPositiveNumberOrNull(row.caseQtyMax);
  const caseQtyMin = caseQtyMinRaw || 1;
  const caseQtyMax = caseQtyMaxRaw === null ? null : Math.max(caseQtyMin, caseQtyMaxRaw);
  const basePriceTl = Number(row.basePriceTl || 0);
  const incrementalPricePerCase = toNumberOrNull(row.incrementalPricePerCase);
  const pricingUnit = normalizeString(row.pricingUnit).toLowerCase() || 'case';

  return {
    id: normalizeString(row.id) || `cargo-tariff-${Date.now()}-${index}`,
    cargoTypeCode: normalizeString(row.cargoTypeCode).toLowerCase(),
    cargoTypeName: normalizeString(row.cargoTypeName),
    deliveryTarget: normalizeString(row.deliveryTarget),
    storageCompatibility: normalizeStorageCompatibility(row.storageCompatibility).join(','),
    distanceType: normalizeDistanceType(row.distanceType, row.isInternalTransfer === true),
    pricingUnit,
    caseQtyMin,
    caseQtyMax,
    basePriceTl: Number.isFinite(basePriceTl) ? basePriceTl : 0,
    incrementalPricePerCase,
    isColdChain: row.isColdChain === true,
    isFrozenChain: row.isFrozenChain === true,
    isInternalTransfer: row.isInternalTransfer === true,
    isActive: row.isActive !== false,
    notes: normalizeString(row.notes),
    // Legacy alanlar read-only tutulur ancak sipariş hesaplamasında kullanılmaz.
    desiMin: hasValue(row.desiMin) ? Number(row.desiMin) : null,
    desiMax: hasValue(row.desiMax) ? Number(row.desiMax) : null,
    incrementalPricePerDesi: hasValue(row.incrementalPricePerDesi) ? Number(row.incrementalPricePerDesi) : null,
  };
};

const isTariffCompatibleByStorage = (tariff, normalizedStorageType) => {
  const compatibility = normalizeStorageCompatibility(tariff.storageCompatibility);
  if (!compatibility.length) return true;

  if (normalizedStorageType === 'internal') {
    return compatibility.includes('internal');
  }

  if (normalizedStorageType === 'frozen') {
    return compatibility.includes('frozen') || compatibility.includes('cold');
  }

  if (normalizedStorageType === 'cold') {
    return compatibility.includes('cold') || compatibility.includes('frozen');
  }

  return compatibility.includes('ambient') || compatibility.includes('cold') || compatibility.includes('frozen');
};

const isTariffCompatibleByDistance = (tariff, normalizedDistanceType) => {
  if (!normalizedDistanceType) return true;
  return normalizeDistanceType(tariff.distanceType, tariff.isInternalTransfer) === normalizedDistanceType;
};

const ensureTariffRows = (rows = []) => {
  const source = Array.isArray(rows) ? rows : [];
  const normalizedSource = source.map((row, index) => normalizeTariffRow(row, index));
  const grouped = groupTariffsByType(normalizedSource);
  const hasUsableCaseBands = Array.from(grouped.values()).some((items) => {
    const active = items.filter((row) => row.isActive !== false);
    if (!active.length) return false;
    const distinctMins = new Set(active.map((row) => Number(row.caseQtyMin || 0)));
    return distinctMins.size > 1
      || active.some((row) => toNumberOrNull(row.caseQtyMax) !== null)
      || active.some((row) => toNumberOrNull(row.incrementalPricePerCase) !== null);
  });
  const normalized = (hasUsableCaseBands ? normalizedSource : buildDefaultCaseTariffs())
    .map((row, index) => normalizeTariffRow(row, index))
    .filter((row) => row.cargoTypeCode && row.cargoTypeName)
    .sort((a, b) => {
      const byType = a.cargoTypeCode.localeCompare(b.cargoTypeCode, 'tr-TR');
      if (byType !== 0) return byType;
      return Number(a.caseQtyMin || 0) - Number(b.caseQtyMin || 0);
    });
  return normalized;
};

const groupTariffsByType = (rows = []) => {
  const grouped = new Map();
  rows.forEach((row) => {
    if (!grouped.has(row.cargoTypeCode)) grouped.set(row.cargoTypeCode, []);
    grouped.get(row.cargoTypeCode).push(row);
  });
  return grouped;
};

const findMatchingBand = (rows = [], caseQty) => {
  const sorted = [...rows].sort((a, b) => a.caseQtyMin - b.caseQtyMin);
  return sorted.find((row) => {
    const max = toNumberOrNull(row.caseQtyMax);
    if (max === null) return caseQty >= row.caseQtyMin;
    return caseQty >= row.caseQtyMin && caseQty <= max;
  }) || null;
};

const buildCargoTypeSummary = (rows = []) => {
  const grouped = groupTariffsByType(rows);
  return Array.from(grouped.entries()).map(([cargoTypeCode, items]) => {
    const first = items[0] || {};
    return {
      cargoTypeCode,
      cargoTypeName: first.cargoTypeName || cargoTypeCode,
      deliveryTarget: first.deliveryTarget || '-',
      storageCompatibility: first.storageCompatibility || 'ambient',
      distanceType: first.distanceType || 'intercity',
      pricingUnit: first.pricingUnit || 'case',
      isColdChain: first.isColdChain === true,
      isFrozenChain: first.isFrozenChain === true,
      isInternalTransfer: first.isInternalTransfer === true,
      isActive: items.some((item) => item.isActive !== false),
      bandCount: items.length,
    };
  });
};

const filterTariffsForSelection = (rows, { storageType, distanceType, isInternalTransfer = false } = {}) => {
  const normalizedStorageType = normalizeStorageType(storageType);
  const normalizedDistanceType = normalizeDistanceType(distanceType, isInternalTransfer);

  return rows.filter((row) => {
    if (row.isActive === false) return false;
    if (!isTariffCompatibleByDistance(row, normalizedDistanceType)) return false;
    return isTariffCompatibleByStorage(row, normalizedStorageType);
  });
};

const calculateQuote = ({
  rows,
  cargoTypeCode,
  caseQty,
  lineItems,
  manualOverrideTl,
  storageType,
  storageTypes,
  distanceType,
  isInternalTransfer = false,
}) => {
  const normalizedCode = normalizeString(cargoTypeCode).toLowerCase();
  const storageContext = deriveStorageContext({ storageType, storageTypes, lineItems });
  const normalizedStorageType = storageContext.normalizedStorageType;
  const normalizedDistanceType = normalizeDistanceType(distanceType, isInternalTransfer);

  if (!normalizedCode) {
    throw new AppError(400, 'cargoTypeCode zorunludur');
  }

  const activeRows = ensureTariffRows(rows).filter((row) => row.isActive !== false);
  const codeRows = activeRows.filter((row) => row.cargoTypeCode === normalizedCode);
  if (!codeRows.length) {
    throw new AppError(404, 'Seçili kargo tipi için aktif tarife bulunamadı');
  }

  const isCompatible = codeRows.every((row) => (
    isTariffCompatibleByDistance(row, normalizedDistanceType)
    && isTariffCompatibleByStorage(row, normalizedStorageType)
  ));

  if (!isCompatible) {
    throw new AppError(400, 'Seçili kargo tipi ürün saklama veya mesafe tipi ile uyumlu değil');
  }

  const normalizedManual = toNumberOrNull(manualOverrideTl);
  let resolvedCaseQty = toPositiveNumberOrNull(caseQty);
  const lineIssues = [];

  if (resolvedCaseQty === null && Array.isArray(lineItems) && lineItems.length) {
    const computedCaseQty = lineItems.reduce((sum, line) => {
      const { caseQty: lineCaseQty, issue } = estimateCaseQtyFromLine(line);
      if (issue) {
        lineIssues.push(issue);
        return sum;
      }
      return sum + Math.max(0, Number(lineCaseQty || 0));
    }, 0);
    if (computedCaseQty > 0) {
      resolvedCaseQty = computedCaseQty;
    }
  }

  if (resolvedCaseQty === null && normalizedManual === null) {
    const details = lineIssues.length
      ? ` ${Array.from(new Set(lineIssues)).join(' ')}`
      : ' Koli karşılığı hesaplanamadı.';
    throw new AppError(400, `Kargo fiyatı hesaplanamadı: case pack eksik veya koli bilgisi bulunamadı.${details}`);
  }

  if (normalizedManual !== null) {
    return {
      cargoTypeCode: normalizedCode,
      cargoTypeName: codeRows[0].cargoTypeName,
      deliveryTarget: codeRows[0].deliveryTarget,
      pricingUnit: 'case',
      distanceType: normalizedDistanceType,
      storageType: normalizedStorageType,
      storageTypes: storageContext.storageTypes,
      caseQty: resolvedCaseQty,
      mixedStoragePolicy: storageContext.mixedStoragePolicy,
      mixedStorageMessage: storageContext.mixedStorageMessage,
      basePriceTl: Number(normalizedManual.toFixed(2)),
      incrementalPricePerCase: 0,
      incrementalTotalTl: 0,
      totalPriceTl: Number(normalizedManual.toFixed(2)),
      calculatedBy: 'manual_override',
      calculationMethod: 'manual_override',
      appliedBand: null,
      issues: Array.from(new Set(lineIssues)),
    };
  }

  const matchingBand = findMatchingBand(codeRows, resolvedCaseQty);
  if (!matchingBand) {
    throw new AppError(400, 'Belirtilen koli miktarı için uygun fiyat bandı bulunamadı');
  }

  const incrementalPerCase = toNumberOrNull(matchingBand.incrementalPricePerCase) || 0;
  const bandMax = toNumberOrNull(matchingBand.caseQtyMax);
  const incrementalStart = bandMax === null ? Math.max(0, Number(matchingBand.caseQtyMin || 1) - 1) : bandMax;
  const extraCaseQty = Math.max(0, resolvedCaseQty - incrementalStart);
  const incrementalTotal = Number((extraCaseQty * incrementalPerCase).toFixed(2));
  const total = Number((Number(matchingBand.basePriceTl || 0) + incrementalTotal).toFixed(2));

  return {
    cargoTypeCode: normalizedCode,
    cargoTypeName: matchingBand.cargoTypeName,
    deliveryTarget: matchingBand.deliveryTarget,
    pricingUnit: matchingBand.pricingUnit || 'case',
    distanceType: normalizedDistanceType,
    storageType: normalizedStorageType,
    storageTypes: storageContext.storageTypes,
    mixedStoragePolicy: storageContext.mixedStoragePolicy,
    mixedStorageMessage: storageContext.mixedStorageMessage,
    caseQty: Number(resolvedCaseQty.toFixed(2)),
    basePriceTl: Number(Number(matchingBand.basePriceTl || 0).toFixed(2)),
    incrementalPricePerCase: Number(incrementalPerCase.toFixed(2)),
    incrementalTotalTl: incrementalTotal,
    totalPriceTl: total,
    calculatedBy: 'tariff',
    calculationMethod: 'case_band_tariff',
    appliedBand: {
      caseQtyMin: matchingBand.caseQtyMin,
      caseQtyMax: matchingBand.caseQtyMax,
      notes: matchingBand.notes || '',
    },
    issues: Array.from(new Set(lineIssues)),
  };
};

export const logisticsTariffService = {
  normalizeTariffs: ensureTariffRows,
  normalizeStorageType,
  normalizeDistanceType,
  buildCargoTypeSummary,
  filterTariffsForSelection,
  calculateQuote,
};

