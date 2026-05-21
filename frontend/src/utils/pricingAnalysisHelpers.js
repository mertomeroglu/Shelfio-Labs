export const riskToneMap = {
  low: 'success',
  medium: 'warning',
  high: 'warning',
  critical: 'danger',
  unknown: 'neutral',
};

export const sktToneMap = {
  safe: 'success',
  soon: 'warning',
  critical: 'danger',
  unknown: 'neutral',
};

export const salesSpeedToneMap = {
  fast: 'success',
  normal: 'primary',
  slow: 'warning',
};

export const salesTrendLabelMap = {
  up: 'Yukselen',
  down: 'Dusen',
  flat: 'Dengeli',
};

export const salesTrendSymbolMap = {
  up: '+',
  down: '-',
  flat: '=',
};

export function boolToQueryValue(value) {
  if (value === true) return 'true';
  if (value === false) return 'false';
  return '';
}

export function toRiskLabel(level) {
  if (level === 'critical') return 'Kritik';
  if (level === 'high') return 'Yüksek';
  if (level === 'medium') return 'Orta';
  if (level === 'low') return 'Düşük';
  return 'Belirsiz';
}

export function toSktLabel(status) {
  if (status === 'critical') return 'Kritik';
  if (status === 'soon') return 'Yaklasiyor';
  if (status === 'safe') return 'Guvenli';
  return 'Bilinmiyor';
}

export function formatDaysLabel(days) {
  if (days === null || days === undefined) return '-';
  if (days < 0) return `Gecmis ${Math.abs(Math.round(days))} gun`;
  return `${Math.round(days)} gun`;
}

export function formatPercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 'Veri yok';
  return `%${numeric.toFixed(0)}`;
}
