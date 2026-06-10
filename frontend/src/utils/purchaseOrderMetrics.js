import {
  PURCHASE_ORDER_STATUSES,
  normalizePurchaseOrderStatus,
} from './purchaseOrderLifecycle.js';

const HOUR_MS = 60 * 60 * 1000;

const parseDate = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
};

export const getOrderDateBounds = (filters = {}) => {
  const explicitFrom = parseDate(filters.orderDateFromTime);
  const explicitTo = parseDate(filters.orderDateToTime);

  const from = explicitFrom || parseDate(filters.orderDateFrom);
  const to = explicitTo || parseDate(filters.orderDateTo);

  if (from && !explicitFrom) from.setHours(0, 0, 0, 0);
  if (to && !explicitTo) to.setHours(23, 59, 59, 999);

  return {
    from: from?.getTime() ?? Number.NaN,
    to: to?.getTime() ?? Number.NaN,
  };
};

export const isOrderWithinDateBounds = (createdAt, filters = {}) => {
  const createdTime = parseDate(createdAt)?.getTime();
  if (!Number.isFinite(createdTime)) {
    return !filters.orderDateFrom && !filters.orderDateTo
      && !filters.orderDateFromTime && !filters.orderDateToTime;
  }

  const { from, to } = getOrderDateBounds(filters);
  if (Number.isFinite(from) && createdTime < from) return false;
  if (Number.isFinite(to) && createdTime > to) return false;
  return true;
};

export const buildOrderDatePreset = (preset, nowValue = new Date()) => {
  const now = new Date(nowValue);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(today);
  endOfToday.setHours(23, 59, 59, 999);
  const toLocalDate = (date) => [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');

  if (preset === 'today') {
    return {
      orderDateFrom: toLocalDate(today),
      orderDateTo: toLocalDate(today),
      orderDateFromTime: today.toISOString(),
      orderDateToTime: endOfToday.toISOString(),
    };
  }

  if (preset === 'last24') {
    const from = new Date(now.getTime() - 24 * HOUR_MS);
    return {
      orderDateFrom: toLocalDate(from),
      orderDateTo: toLocalDate(now),
      orderDateFromTime: from.toISOString(),
      orderDateToTime: now.toISOString(),
    };
  }

  if (preset === 'last7') {
    const from = new Date(today);
    from.setDate(from.getDate() - 6);
    return {
      orderDateFrom: toLocalDate(from),
      orderDateTo: toLocalDate(today),
      orderDateFromTime: from.toISOString(),
      orderDateToTime: endOfToday.toISOString(),
    };
  }

  return {
    orderDateFrom: '',
    orderDateTo: '',
    orderDateFromTime: '',
    orderDateToTime: '',
  };
};

const getStatusIndex = (status) => PURCHASE_ORDER_STATUSES.indexOf(normalizePurchaseOrderStatus(status));

export const calculateLifecycleStageMetric = ({
  orders = [],
  startStatus,
  endStatus,
  getStatusTimestamp,
  now = Date.now(),
}) => {
  const startIndex = getStatusIndex(startStatus);
  const endIndex = getStatusIndex(endStatus);
  const durations = [];
  let activeCount = 0;
  let completedCount = 0;

  orders.forEach((order) => {
    const start = getStatusTimestamp(order, startStatus);
    if (!Number.isFinite(start)) return;

    const currentStatus = normalizePurchaseOrderStatus(order.currentStatus || order.status);
    const currentIndex = getStatusIndex(currentStatus);
    const end = getStatusTimestamp(order, endStatus);
    const hasReachedEnd = currentIndex >= endIndex
      && currentStatus !== 'cancelled'
      && currentStatus !== 'archived';
    if (hasReachedEnd && Number.isFinite(end) && end > start) {
      durations.push((end - start) / HOUR_MS);
      completedCount += 1;
      return;
    }

    const isActive = currentIndex >= startIndex
      && currentIndex < endIndex
      && currentStatus !== 'cancelled'
      && currentStatus !== 'archived';

    if (isActive && now > start) {
      durations.push((now - start) / HOUR_MS);
      activeCount += 1;
    }
  });

  return {
    averageHours: durations.length
      ? durations.reduce((sum, value) => sum + value, 0) / durations.length
      : null,
    activeCount,
    completedCount,
    sampleCount: durations.length,
  };
};
