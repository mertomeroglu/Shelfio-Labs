const normalizeDate = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
};

export const addCalendarDays = (baseDate, days) => {
  const target = new Date(baseDate);
  const numericDays = Number(days);
  const offset = Number.isFinite(numericDays) ? Math.trunc(numericDays) : 0;
  target.setDate(target.getDate() + offset);
  return target;
};

export const getPurchaseSalesWindow = (baseDate = new Date()) => {
  const end = new Date(baseDate);
  const start30 = addCalendarDays(end, -29);
  const start14 = addCalendarDays(end, -13);
  const start7 = addCalendarDays(end, -6);
  start30.setHours(0, 0, 0, 0);
  start14.setHours(0, 0, 0, 0);
  start7.setHours(0, 0, 0, 0);
  return { start30, start14, start7, end };
};

const getDemandSignals = ({ sold7, sold14, sold30, avg7, avg14, avg30 }) => {
  const weighted = Number((avg7 * 0.5 + avg14 * 0.3 + avg30 * 0.2).toFixed(3));
  const trendRatio = avg14 > 0 ? Number(((avg7 - avg14) / avg14).toFixed(3)) : avg7 > 0 ? 1 : 0;

  let trendDirection = 'flat';
  if (trendRatio >= 0.12) trendDirection = 'up';
  else if (trendRatio <= -0.12) trendDirection = 'down';

  let salesSpeed = 'normal';
  if (avg7 >= Math.max(1.2, avg30 * 1.18)) salesSpeed = 'fast';
  else if (avg7 <= Math.max(0.25, avg30 * 0.72)) salesSpeed = 'slow';

  return {
    sold7,
    sold14,
    sold30,
    avg7,
    avg14,
    avg30,
    weighted,
    trendRatio,
    trendDirection,
    salesSpeed,
  };
};

export const createEmptyDemandSignals = () => getDemandSignals({
  sold7: 0,
  sold14: 0,
  sold30: 0,
  avg7: 0,
  avg14: 0,
  avg30: 0,
});

export const buildPurchaseSalesSignalsMap = (sales = [], baseDate = new Date()) => {
  const { start30, start14, start7, end } = getPurchaseSalesWindow(baseDate);
  const totals = new Map();

  for (const sale of sales) {
    const createdAt = normalizeDate(sale.createdAt);
    if (!createdAt || createdAt < start30 || createdAt > end) continue;

    const sign = String(sale.type || '').toLowerCase() === 'return' ? -1 : 1;
    const items = Array.isArray(sale.items) ? sale.items : [];
    for (const item of items) {
      const productId = String(item?.productId || '').trim();
      if (!productId || productId === '__bag__') continue;
      const qty = Number(item?.quantity || 0) * sign;
      if (!Number.isFinite(qty) || qty === 0) continue;

      const row = totals.get(productId) || { sold7: 0, sold14: 0, sold30: 0 };
      row.sold30 += qty;
      if (createdAt >= start14) row.sold14 += qty;
      if (createdAt >= start7) row.sold7 += qty;
      totals.set(productId, row);
    }
  }

  const result = new Map();
  for (const [productId, totalsRow] of totals.entries()) {
    const sold7 = Math.max(0, Number(totalsRow.sold7.toFixed(2)));
    const sold14 = Math.max(0, Number(totalsRow.sold14.toFixed(2)));
    const sold30 = Math.max(0, Number(totalsRow.sold30.toFixed(2)));
    result.set(productId, getDemandSignals({
      sold7,
      sold14,
      sold30,
      avg7: Number((sold7 / 7).toFixed(3)),
      avg14: Number((sold14 / 14).toFixed(3)),
      avg30: Number((sold30 / 30).toFixed(3)),
    }));
  }

  return result;
};
