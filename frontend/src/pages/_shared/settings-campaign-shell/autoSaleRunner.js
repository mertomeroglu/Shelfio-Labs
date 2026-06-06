import { posService } from '../../../services/posService.js';

export const AUTO_SALE_SOURCE = 'otomatik_satis_paneli';

export const AUTO_SALE_DENSITY_OPTIONS = [
  { value: 'low', label: 'Düşük', minDelay: 12000, maxDelay: 18000 },
  { value: 'medium', label: 'Orta', minDelay: 6000, maxDelay: 10000 },
  { value: 'high', label: 'Yüksek', minDelay: 2500, maxDelay: 5000 },
];

export const AUTO_SALE_DURATION_OPTIONS = [
  { value: '15', label: '15 dakika', minutes: 15 },
  { value: '30', label: '30 dakika', minutes: 30 },
  { value: '60', label: '1 saat', minutes: 60 },
  { value: 'custom', label: 'Özel süre', minutes: null },
  { value: 'manual', label: 'Manuel durdurulana kadar', minutes: null },
];

export const DEFAULT_AUTO_SALE_CONFIG = {
  density: 'medium',
  deskCodes: ['B1', 'B2', 'B3'],
  minAmount: '50',
  maxAmount: '500',
  duration: 'manual',
  customMinutes: '15',
  returnRate: '3',
  minProductCount: '1',
  maxProductCount: '3',
};

export const DEFAULT_AUTO_SALE_SUMMARY = {
  totalCount: 0,
  totalAmount: 0,
  lastSaleAt: '',
  activeDeskCodes: [],
  returnedCount: 0,
  endsAt: '',
};

const STORAGE_KEY = 'shelfio.auto_sale.runner.v1';
const listeners = new Set();

let timerId = null;
let countdownId = null;
let runningTick = false;

const clone = (value) => JSON.parse(JSON.stringify(value));
const roundMoney = (value) => Math.round((Number(value) || 0) * 100) / 100;

const normalizeConfig = (config = {}) => ({
  ...DEFAULT_AUTO_SALE_CONFIG,
  ...config,
  deskCodes: Array.isArray(config.deskCodes) && config.deskCodes.length
    ? config.deskCodes
    : DEFAULT_AUTO_SALE_CONFIG.deskCodes,
});

let state = {
  active: false,
  config: normalizeConfig(DEFAULT_AUTO_SALE_CONFIG),
  summary: { ...DEFAULT_AUTO_SALE_SUMMARY },
  error: '',
  remainingMs: null,
  returnAccumulator: 0,
  recentTransactions: [],
};

const AUTO_SALE_DENSITY_RUNTIME = {
  low: { minDelay: 14000, maxDelay: 20000, salesPerTick: 1 },
  medium: { minDelay: 5000, maxDelay: 8000, salesPerTick: 1 },
  high: { minDelay: 1200, maxDelay: 2500, salesPerTick: 2 },
};

const normalizeAutoSaleTransaction = (record = {}) => ({
  referenceNo: record.referenceNo || '',
  type: record.type || 'sale',
  totalAmount: roundMoney(record.totalAmount || 0),
  deskCode: record.deskCode || '',
  paymentMethod: record.paymentMethod || '',
  createdAt: record.createdAt || new Date().toISOString(),
  itemCount: Array.isArray(record.items) ? record.items.reduce((sum, item) => sum + Math.max(0, Number(item?.quantity || 0)), 0) : 0,
});

const mergeRecentTransactions = (current = [], nextRows = []) => {
  const byReference = new Map();
  [...nextRows, ...current].forEach((row) => {
    const normalized = normalizeAutoSaleTransaction(row);
    if (!normalized.referenceNo || byReference.has(normalized.referenceNo)) return;
    byReference.set(normalized.referenceNo, normalized);
  });
  return Array.from(byReference.values())
    .sort((left, right) => new Date(right.createdAt || 0) - new Date(left.createdAt || 0))
    .slice(0, 5);
};

const getErrorMessage = (error) => (
  error?.payload?.message
  || error?.response?.message
  || error?.message
  || 'Otomatik satis olusturulamadi.'
);

const readStoredState = () => {
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return;
    const endsAtMs = parsed.summary?.endsAt ? new Date(parsed.summary.endsAt).getTime() : null;
    state = {
      active: parsed.active === true && (!endsAtMs || endsAtMs > Date.now()),
      config: normalizeConfig(parsed.config),
      summary: { ...DEFAULT_AUTO_SALE_SUMMARY, ...(parsed.summary || {}) },
      error: '',
      remainingMs: endsAtMs ? Math.max(0, endsAtMs - Date.now()) : null,
      returnAccumulator: Number(parsed.returnAccumulator || 0),
      recentTransactions: Array.isArray(parsed.recentTransactions) ? parsed.recentTransactions.slice(0, 5) : [],
    };
    if (parsed.active === true && endsAtMs && endsAtMs <= Date.now()) {
      state.active = false;
      state.remainingMs = 0;
    }
  } catch {
    // ignore storage errors
  }
};

const persist = () => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      active: state.active,
      config: state.config,
      summary: state.summary,
      returnAccumulator: state.returnAccumulator,
      recentTransactions: state.recentTransactions,
    }));
  } catch {
    // ignore storage errors
  }
};

const emit = () => {
  const snapshot = autoSaleRunner.getSnapshot();
  listeners.forEach((listener) => listener(snapshot));
};

const commit = (patch) => {
  state = { ...state, ...patch };
  persist();
  emit();
};

const resolveDurationMinutes = (config) => {
  if (config.duration === 'manual') return null;
  if (config.duration === 'custom') {
    const custom = Number(config.customMinutes);
    return Number.isFinite(custom) && custom > 0 ? custom : null;
  }
  const option = AUTO_SALE_DURATION_OPTIONS.find((item) => item.value === config.duration);
  return option?.minutes || null;
};

const getEndsAtMs = () => {
  const value = state.summary?.endsAt;
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
};

const clearTimers = () => {
  if (timerId) {
    window.clearTimeout(timerId);
    timerId = null;
  }
  if (countdownId) {
    window.clearInterval(countdownId);
    countdownId = null;
  }
};

const validateAutoSaleConfig = (config = state.config) => {
  const normalized = normalizeConfig(config);
  const hasBlankMinAmount = String(normalized.minAmount ?? '').trim() === '';
  const hasBlankMaxAmount = String(normalized.maxAmount ?? '').trim() === '';
  const hasBlankMinProductCount = String(normalized.minProductCount ?? '').trim() === '';
  const hasBlankMaxProductCount = String(normalized.maxProductCount ?? '').trim() === '';
  const minAmount = Number(normalized.minAmount);
  const maxAmount = Number(normalized.maxAmount);
  const minProductCount = Number(normalized.minProductCount);
  const maxProductCount = Number(normalized.maxProductCount);

  if (!Array.isArray(normalized.deskCodes) || normalized.deskCodes.length === 0) {
    return 'En az bir kasa seçilmelidir.';
  }
  if (hasBlankMinAmount || hasBlankMaxAmount) {
    return 'Minimum ve maksimum tutar boş bırakılamaz.';
  }
  if (!Number.isFinite(minAmount) || !Number.isFinite(maxAmount)) {
    return 'Minimum ve maksimum tutar boş bırakılamaz.';
  }
  if (minAmount <= 0 || maxAmount <= 0) {
    return 'Satış tutarları sıfırdan büyük olmalıdır.';
  }
  if (minAmount > maxAmount) {
    return 'Minimum tutar, maksimum tutardan büyük olamaz.';
  }
  if (hasBlankMinProductCount || hasBlankMaxProductCount) {
    return 'Minimum ve maksimum ürün çeşidi boş bırakılamaz.';
  }
  if (!Number.isFinite(minProductCount) || !Number.isFinite(maxProductCount) || minProductCount < 1 || maxProductCount < 1) {
    return 'Ürün çeşidi sayısı en az 1 olmalıdır.';
  }
  if (minProductCount > maxProductCount) {
    return 'Minimum ürün çeşidi maksimumdan büyük olamaz.';
  }
  const returnRate = Number(normalized.returnRate);
  if (!Number.isFinite(returnRate) || returnRate < 0 || returnRate > 100) {
    return 'İade oranı 0 ile 100 arasında olmalıdır.';
  }
  const durationMinutes = resolveDurationMinutes(normalized);
  if (normalized.duration === 'custom' && (!durationMinutes || durationMinutes <= 0)) {
    return 'Özel süre dakika olarak sıfırdan büyük olmalıdır.';
  }
  return '';
};

const scheduleCountdown = () => {
  if (typeof window === 'undefined') return;
  if (countdownId) window.clearInterval(countdownId);
  countdownId = window.setInterval(() => {
    const endsAtMs = getEndsAtMs();
    if (!endsAtMs) {
      commit({ remainingMs: null });
      return;
    }
    const remainingMs = Math.max(0, endsAtMs - Date.now());
    commit({ remainingMs });
    if (remainingMs <= 0) {
      autoSaleRunner.stop();
    }
  }, 1000);
};

const scheduleNext = () => {
  if (typeof window === 'undefined' || !state.active) return;
  const endsAtMs = getEndsAtMs();
  if (endsAtMs && Date.now() >= endsAtMs) {
    autoSaleRunner.stop();
    return;
  }

  const densityOption = AUTO_SALE_DENSITY_OPTIONS.find((item) => item.value === state.config.density) || AUTO_SALE_DENSITY_OPTIONS[1];
  const density = { ...densityOption, ...(AUTO_SALE_DENSITY_RUNTIME[densityOption.value] || {}) };
  const delay = density.minDelay + Math.floor(Math.random() * (density.maxDelay - density.minDelay + 1));
  const safeDelay = endsAtMs ? Math.min(delay, Math.max(0, endsAtMs - Date.now())) : delay;

  if (timerId) window.clearTimeout(timerId);
  timerId = window.setTimeout(() => {
    void createTick();
  }, safeDelay);
};

const createTick = async () => {
  if (!state.active || runningTick) return;
  const endsAtMs = getEndsAtMs();
  if (endsAtMs && Date.now() >= endsAtMs) {
    autoSaleRunner.stop();
    return;
  }

  runningTick = true;
  const config = normalizeConfig(state.config);
  const deskCodes = Array.isArray(config.deskCodes) ? config.deskCodes : [];
  const densityOption = AUTO_SALE_DENSITY_OPTIONS.find((item) => item.value === config.density) || AUTO_SALE_DENSITY_OPTIONS[1];
  const density = { ...densityOption, ...(AUTO_SALE_DENSITY_RUNTIME[densityOption.value] || {}) };
  const saleCount = Math.max(1, Math.min(Number(density.salesPerTick || 1), Math.max(1, deskCodes.length), 3));
  const selectedDeskCodes = [...deskCodes].sort(() => Math.random() - 0.5).slice(0, saleCount);

  try {
    const createdSales = [];
    const createdTransactions = [];

    for (const deskCode of selectedDeskCodes) {
      const response = await posService.createAutomaticSale({
        deskCode,
        minAmount: roundMoney(config.minAmount),
        maxAmount: roundMoney(config.maxAmount),
        minProductCount: Math.max(1, Math.floor(Number(config.minProductCount || 1))),
        maxProductCount: Math.max(1, Math.floor(Number(config.maxProductCount || 1))),
        returnRate: Math.max(0, Math.min(Number(config.returnRate || 0), 100)) / 100,
        forceReturn: false,
        source: AUTO_SALE_SOURCE,
      });
      const sale = response?.data || response;
      createdSales.push(sale);
      createdTransactions.push(sale);
      if (sale?.automaticReturnRecord) {
        createdTransactions.push(sale.automaticReturnRecord);
      }
    }

    const saleAmount = createdSales.reduce((sum, sale) => sum + Number(sale?.totalAmount ?? 0), 0);
    const saleTime = createdSales[createdSales.length - 1]?.createdAt || new Date().toISOString();
    commit({
      error: '',
      summary: {
        ...state.summary,
        totalCount: Number(state.summary.totalCount || 0) + createdSales.length,
        totalAmount: roundMoney(Number(state.summary.totalAmount || 0) + saleAmount),
        lastSaleAt: saleTime,
        activeDeskCodes: deskCodes,
        returnedCount: Number(state.summary.returnedCount || 0) + createdSales.filter((sale) => sale?.automaticReturnCreated).length,
      },
      returnAccumulator: state.returnAccumulator,
      recentTransactions: mergeRecentTransactions(state.recentTransactions, createdTransactions),
    });
    runningTick = false;
    scheduleNext();
  } catch (error) {
    runningTick = false;
    commit({ error: getErrorMessage(error) });
    autoSaleRunner.stop({ keepError: true });
  }
};

readStoredState();

export const autoSaleRunner = {
  getSnapshot() {
    const endsAtMs = getEndsAtMs();
    return clone({
      ...state,
      remainingMs: endsAtMs ? Math.max(0, endsAtMs - Date.now()) : null,
    });
  },
  subscribe(listener) {
    listeners.add(listener);
    listener(this.getSnapshot());
    return () => listeners.delete(listener);
  },
  updateConfig(nextConfig) {
    commit({ config: normalizeConfig(nextConfig), error: '' });
  },
  clearError() {
    if (!state.error) return;
    commit({ error: '' });
  },
  async refreshRecentTransactions() {
    try {
      const response = await posService.getAutomaticPanelTransactions(5);
      const rows = Array.isArray(response?.data) ? response.data : (Array.isArray(response) ? response : []);
      commit({
        recentTransactions: mergeRecentTransactions([], rows),
        ...(rows.length ? { error: '' } : {}),
      });
    } catch {
      // Recent transaction history is supportive; do not stop the runner.
    }
  },
  validate: validateAutoSaleConfig,
  start(config) {
    if (state.active) return '';
    const normalized = normalizeConfig(config);
    const validationError = validateAutoSaleConfig(normalized);
    if (validationError) {
      commit({ error: validationError });
      return validationError;
    }
    const durationMinutes = resolveDurationMinutes(normalized);
    const endsAt = durationMinutes ? new Date(Date.now() + (durationMinutes * 60 * 1000)).toISOString() : '';
    clearTimers();
    commit({
      active: true,
      config: normalized,
      error: '',
      remainingMs: endsAt ? new Date(endsAt).getTime() - Date.now() : null,
      summary: {
        ...state.summary,
        activeDeskCodes: normalized.deskCodes,
        endsAt,
      },
    });
    scheduleCountdown();
    void this.refreshRecentTransactions();
    void createTick();
    return '';
  },
  stop(options = {}) {
    clearTimers();
    commit({
      active: false,
      error: options.keepError ? state.error : '',
      remainingMs: null,
      summary: {
        ...state.summary,
        endsAt: '',
      },
    });
  },
  resumeIfNeeded() {
    if (!state.active) return;
    const endsAtMs = getEndsAtMs();
    if (endsAtMs && endsAtMs <= Date.now()) {
      this.stop();
      return;
    }
    scheduleCountdown();
    void this.refreshRecentTransactions();
    scheduleNext();
  },
};

autoSaleRunner.resumeIfNeeded();
