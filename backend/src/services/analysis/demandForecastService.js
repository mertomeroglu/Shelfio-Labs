const DAY_MS = 24 * 60 * 60 * 1000;

const toDayKey = (value) => new Date(value).toISOString().slice(0, 10);

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const getDateWindow = (analysisDate, days) => {
  const end = new Date(`${analysisDate}T23:59:59.999Z`);
  const start = new Date(end.getTime() - (days - 1) * DAY_MS);
  start.setUTCHours(0, 0, 0, 0);
  return { start, end };
};

const inRange = (date, start, end) => date >= start && date <= end;

const getTrendDirection = (avg7, prevAvg7) => {
  if (!Number.isFinite(avg7) || !Number.isFinite(prevAvg7)) return 'flat';
  if (avg7 > prevAvg7 * 1.1) return 'up';
  if (avg7 < prevAvg7 * 0.9) return 'down';
  return 'flat';
};

const getSalesSpeed = (avgDaily7, avgDaily30) => {
  if (avgDaily7 >= Math.max(1.5, avgDaily30 * 1.15)) return 'fast';
  if (avgDaily7 <= Math.max(0.25, avgDaily30 * 0.7)) return 'slow';
  return 'normal';
};

export const demandForecastService = {
  buildProductSalesMetrics({ sales, analysisDate }) {
    const map = new Map();
    const date30 = getDateWindow(analysisDate, 30);
    const date7 = getDateWindow(analysisDate, 7);
    const prev7End = new Date(date7.start.getTime() - 1);
    const prev7Start = new Date(prev7End.getTime() - 6 * DAY_MS);
    prev7Start.setUTCHours(0, 0, 0, 0);

    for (const record of sales) {
      const createdAt = new Date(record.createdAt);
      if (!Number.isFinite(createdAt.getTime())) continue;

      const sign = record.type === 'return' ? -1 : 1;
      const items = Array.isArray(record.items) ? record.items : [];

      for (const item of items) {
        const productId = item.productId;
        if (!productId || productId === '__bag__') continue;
        const qty = Number(item.quantity || 0) * sign;
        if (!Number.isFinite(qty) || qty === 0) continue;

        const current = map.get(productId) || {
          sold7: 0,
          sold30: 0,
          soldPrev7: 0,
          daily: new Map(),
        };

        if (inRange(createdAt, date30.start, date30.end)) {
          current.sold30 += qty;
        }

        if (inRange(createdAt, date7.start, date7.end)) {
          current.sold7 += qty;
        }

        if (inRange(createdAt, prev7Start, prev7End)) {
          current.soldPrev7 += qty;
        }

        const dayKey = toDayKey(createdAt);
        current.daily.set(dayKey, (current.daily.get(dayKey) || 0) + qty);
        map.set(productId, current);
      }
    }

    const enriched = new Map();

    for (const [productId, value] of map.entries()) {
      const sold7 = Math.max(0, value.sold7);
      const sold30 = Math.max(0, value.sold30);
      const soldPrev7 = Math.max(0, value.soldPrev7);
      const avgDaily7 = sold7 / 7;
      const avgDaily30 = sold30 / 30;
      const prevAvgDaily7 = soldPrev7 / 7;
      const trendDirection = getTrendDirection(avgDaily7, prevAvgDaily7);
      const trendRatio = prevAvgDaily7 > 0 ? (avgDaily7 - prevAvgDaily7) / prevAvgDaily7 : avgDaily7 > 0 ? 1 : 0;

      enriched.set(productId, {
        sold7,
        sold30,
        soldPrev7,
        avgDaily7: Number(avgDaily7.toFixed(2)),
        avgDaily30: Number(avgDaily30.toFixed(2)),
        prevAvgDaily7: Number(prevAvgDaily7.toFixed(2)),
        trendDirection,
        trendRatio: Number(clamp(trendRatio, -1, 2).toFixed(2)),
        salesSpeed: getSalesSpeed(avgDaily7, avgDaily30),
      });
    }

    return enriched;
  },

  buildWeeklyPattern({ sales, analysisDate }) {
    const date30 = getDateWindow(analysisDate, 30);
    const dayNames = ['Pazar', 'Pazartesi', 'Sali', 'Carsamba', 'Persembe', 'Cuma', 'Cumartesi'];
    const totals = new Map(dayNames.map((name) => [name, 0]));

    for (const record of sales) {
      const createdAt = new Date(record.createdAt);
      if (!inRange(createdAt, date30.start, date30.end)) continue;

      const items = Array.isArray(record.items) ? record.items : [];
      const qty = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
      const dayName = dayNames[createdAt.getUTCDay()];
      const sign = record.type === 'return' ? -1 : 1;
      totals.set(dayName, (totals.get(dayName) || 0) + qty * sign);
    }

    const rows = dayNames.map((name) => ({
      day: name,
      totalSales: Math.max(0, Number((totals.get(name) || 0).toFixed(2))),
    }));

    const sorted = [...rows].sort((a, b) => b.totalSales - a.totalSales);

    return {
      days: rows,
      highestDay: sorted[0]?.day || '-',
      lowestDay: sorted[sorted.length - 1]?.day || '-',
      insights: [
        `${sorted[0]?.day || '-'} günü satış yoğunluğu en yüksek görünüyor.`,
        `${sorted[sorted.length - 1]?.day || '-'} günü göreli olarak daha düşük performans sergiliyor.`,
      ],
    };
  },
};

