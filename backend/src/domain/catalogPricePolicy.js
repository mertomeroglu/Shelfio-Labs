const INVISIBLE_SPACE_PATTERN = /[\u00a0\u2007\u202f\u200b-\u200d\ufeff\s]/g;

const result = (value, confidence, reason, rawValue) => ({
  value,
  confidence,
  reason,
  rawValue,
});

export const parseCatalogNumber = (rawValue) => {
  if (typeof rawValue === 'number') {
    return Number.isFinite(rawValue)
      ? result(rawValue, 'high', 'native_number', rawValue)
      : result(null, 'low', 'non_finite_number', rawValue);
  }

  if (rawValue === null || rawValue === undefined || rawValue === '') {
    return result(null, 'low', 'empty_value', rawValue);
  }

  const normalized = String(rawValue)
    .normalize('NFKC')
    .replace(INVISIBLE_SPACE_PATTERN, '')
    .replace(/[^\d.,+-]/g, '');

  if (!normalized || !/\d/.test(normalized)) {
    return result(null, 'low', 'no_numeric_content', rawValue);
  }

  const signCount = (normalized.match(/[+-]/g) || []).length;
  if (signCount > 1 || /[+-]/.test(normalized.slice(1))) {
    return result(null, 'low', 'invalid_sign', rawValue);
  }

  const sign = normalized.startsWith('-') ? -1 : 1;
  const unsigned = normalized.replace(/^[+-]/, '');
  const dotCount = (unsigned.match(/\./g) || []).length;
  const commaCount = (unsigned.match(/,/g) || []).length;
  let numericText = unsigned;
  let confidence = 'high';
  let reason = 'integer';

  if (dotCount && commaCount) {
    const decimalSeparator =
      unsigned.lastIndexOf('.') > unsigned.lastIndexOf(',') ? '.' : ',';
    const thousandsSeparator = decimalSeparator === '.' ? ',' : '.';
    const decimalIndex = unsigned.lastIndexOf(decimalSeparator);
    const integerPart = unsigned
      .slice(0, decimalIndex)
      .replaceAll(thousandsSeparator, '')
      .replaceAll(decimalSeparator, '');
    const decimalPart = unsigned.slice(decimalIndex + 1).replace(/[.,]/g, '');
    numericText = `${integerPart}.${decimalPart}`;
    reason =
      decimalSeparator === ','
        ? 'mixed_separators_comma_decimal'
        : 'mixed_separators_dot_decimal';
  } else if (dotCount || commaCount) {
    const separator = dotCount ? '.' : ',';
    const parts = unsigned.split(separator);
    const trailingDigits = parts.at(-1).length;

    if (parts.length > 2) {
      const allThousandsGroups = parts.slice(1).every((part) => part.length === 3);
      if (allThousandsGroups) {
        numericText = parts.join('');
        confidence = 'medium';
        reason = 'repeated_thousands_separator';
      } else if (trailingDigits >= 1 && trailingDigits <= 2) {
        numericText = `${parts.slice(0, -1).join('')}.${parts.at(-1)}`;
        confidence = 'medium';
        reason = 'repeated_separator_last_group_decimal';
      } else {
        return result(null, 'low', 'ambiguous_repeated_separator', rawValue);
      }
    } else if (trailingDigits >= 1 && trailingDigits <= 2) {
      numericText = `${parts[0]}.${parts[1]}`;
      reason = separator === ',' ? 'comma_decimal' : 'dot_decimal';
    } else if (trailingDigits === 3 && parts[0] !== '0') {
      numericText = parts.join('');
      confidence = 'low';
      reason = 'single_separator_three_digit_group';
    } else {
      numericText = `${parts[0]}.${parts[1]}`;
      confidence = 'low';
      reason = 'single_separator_ambiguous_decimal';
    }
  }

  const parsed = sign * Number(numericText);
  return Number.isFinite(parsed)
    ? result(parsed, confidence, reason, rawValue)
    : result(null, 'low', 'invalid_numeric_value', rawValue);
};

export const evaluateCatalogPriceChange = ({ oldPrice, newPrice }) => {
  const oldValue = typeof oldPrice === 'number' ? oldPrice : Number(oldPrice);
  const newValue = typeof newPrice === 'number' ? newPrice : Number(newPrice);

  if (
    !Number.isFinite(newValue) ||
    newValue <= 0 ||
    (oldPrice !== null &&
      oldPrice !== undefined &&
      (!Number.isFinite(oldValue) || oldValue <= 0))
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

const normalizeToken = (value) => String(value || '').trim().toLocaleLowerCase('tr-TR');

export const normalizePurchasePriceBasis = (value) => {
  const token = normalizeToken(value);
  if (['unit', 'adet', 'birim', 'piece', 'each', 'kg', 'litre', 'liter'].includes(token)) return 'unit';
  if (['case', 'koli', 'kasa', 'carton'].includes(token)) return 'case';
  if (['package', 'pack', 'paket', 'kutu'].includes(token)) return 'package';
  return 'unknown';
};

const positiveNumber = (value) => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export const normalizeCatalogPrice = ({
  purchasePrice,
  purchasePriceBasis,
  unitsPerCase,
  packSize,
  unit,
}) => {
  const price = positiveNumber(purchasePrice);
  const basis = normalizePurchasePriceBasis(purchasePriceBasis);
  const caseUnits = positiveNumber(unitsPerCase);
  const packageUnits = positiveNumber(packSize);

  if (!price) {
    return {
      normalizedUnitPurchasePrice: null,
      normalizedCasePurchasePrice: null,
      priceNormalizationConfidence: 'none',
      priceNormalizationReason: 'invalid_purchase_price',
      priceReviewRequired: true,
    };
  }

  if (basis === 'unit') {
    return {
      normalizedUnitPurchasePrice: price,
      normalizedCasePurchasePrice: caseUnits ? price * caseUnits : null,
      priceNormalizationConfidence: 'high',
      priceNormalizationReason: caseUnits ? 'unit_price_with_case_projection' : 'unit_price',
      priceReviewRequired: false,
    };
  }

  if (basis === 'case') {
    return caseUnits
      ? {
        normalizedUnitPurchasePrice: price / caseUnits,
        normalizedCasePurchasePrice: price,
        priceNormalizationConfidence: 'high',
        priceNormalizationReason: 'case_price_divided_by_units_per_case',
        priceReviewRequired: false,
      }
      : {
        normalizedUnitPurchasePrice: null,
        normalizedCasePurchasePrice: price,
        priceNormalizationConfidence: 'none',
        priceNormalizationReason: 'case_price_missing_units_per_case',
        priceReviewRequired: true,
      };
  }

  if (basis === 'package') {
    return packageUnits && normalizeToken(unit)
      ? {
        normalizedUnitPurchasePrice: price / packageUnits,
        normalizedCasePurchasePrice: caseUnits ? (price / packageUnits) * caseUnits : null,
        priceNormalizationConfidence: 'medium',
        priceNormalizationReason: 'package_price_divided_by_numeric_pack_size',
        priceReviewRequired: false,
      }
      : {
        normalizedUnitPurchasePrice: null,
        normalizedCasePurchasePrice: null,
        priceNormalizationConfidence: 'none',
        priceNormalizationReason: 'package_price_missing_numeric_pack_size_or_unit',
        priceReviewRequired: true,
      };
  }

  return {
    normalizedUnitPurchasePrice: null,
    normalizedCasePurchasePrice: null,
    priceNormalizationConfidence: 'none',
    priceNormalizationReason: 'purchase_price_basis_unknown',
    priceReviewRequired: true,
  };
};

export const compareNormalizedCatalogPrices = ({ oldPrice, newPrice }) => {
  const oldCurrency = normalizeToken(oldPrice?.currency || 'TRY').toUpperCase();
  const newCurrency = normalizeToken(newPrice?.currency || 'TRY').toUpperCase();
  if (oldCurrency !== newCurrency) {
    return {
      difference: null,
      changePct: null,
      diffStatus: 'currency_review_required',
      riskReason: 'currency_mismatch',
      canAutoApprove: false,
    };
  }

  const oldVatIncluded = oldPrice?.vatIncluded;
  const newVatIncluded = newPrice?.vatIncluded;
  if (
    oldVatIncluded !== null &&
    oldVatIncluded !== undefined &&
    newVatIncluded !== null &&
    newVatIncluded !== undefined &&
    Boolean(oldVatIncluded) !== Boolean(newVatIncluded)
  ) {
    return {
      difference: null,
      changePct: null,
      diffStatus: 'vat_review_required',
      riskReason: 'vat_inclusion_mismatch',
      canAutoApprove: false,
    };
  }

  const oldTaxRate = positiveNumber(oldPrice?.taxRate) ?? Number(oldPrice?.taxRate || 0);
  const newTaxRate = positiveNumber(newPrice?.taxRate) ?? Number(newPrice?.taxRate || 0);
  if (Number.isFinite(oldTaxRate) && Number.isFinite(newTaxRate) && oldTaxRate !== newTaxRate) {
    return {
      difference: null,
      changePct: null,
      diffStatus: 'vat_review_required',
      riskReason: 'tax_rate_changed',
      canAutoApprove: false,
    };
  }

  if (oldPrice?.priceReviewRequired || newPrice?.priceReviewRequired) {
    return {
      difference: null,
      changePct: null,
      diffStatus: 'price_review_required',
      riskReason: newPrice?.priceNormalizationReason || oldPrice?.priceNormalizationReason,
      canAutoApprove: false,
    };
  }

  const evaluation = evaluateCatalogPriceChange({
    oldPrice: oldPrice?.normalizedUnitPurchasePrice,
    newPrice: newPrice?.normalizedUnitPurchasePrice,
  });
  if (evaluation.status === 'invalid') {
    return {
      ...evaluation,
      diffStatus: 'invalid_row',
      riskReason: evaluation.priceAnomalyReason,
    };
  }

  return {
    ...evaluation,
    diffStatus:
      evaluation.status === 'increase'
        ? 'price_increased'
        : evaluation.status === 'discount'
          ? 'price_decreased'
          : 'unchanged',
    riskReason: evaluation.requiresManualReview ? 'manual_price_review_required' : null,
  };
};
