import { v4 as uuidv4 } from 'uuid';
import { createFileRepository } from '../repositories/fileRepository.js';
import { sectionRepo } from '../repositories/sectionRepository.js';
import { productRepo } from '../repositories/productRepository.js';
import { stockRepo } from '../repositories/stockRepository.js';
import { userRepo } from '../repositories/userRepository.js';
import { stockService } from './stockService.js';
import { AppError, createNotFoundError } from '../utils/appError.js';
import { sanitizeSectionInput, validateSectionPayload, includesSearchText } from '../utils/validators.js';
import { config } from '../config/config.js';
import { getPrisma } from '../providers/postgresProvider.js';
import { withPostgresQueryLogging } from '../utils/performanceLogger.js';
import { isActiveRetailProduct } from '../utils/retailStockPolicy.js';
import { cleanSectionDisplayName } from '../utils/displayLabels.js';
import { getActiveTenantId } from '../tenant/tenantContext.js';

const transferRequestRepo = createFileRepository({ fileName: 'stockTransferRequests.json', defaultData: [] });
const transferRequestAuditRepo = createFileRepository({ fileName: 'stockTransferRequestAudits.json', defaultData: [] });

const TRANSFER_REQUEST_STATUSES = new Set(['Bekliyor', 'Onaylandı', 'Gerçekleştiriliyor', 'Tamamlandı', 'Hatalı İşlem', 'Reddedildi', 'İptal Edildi', 'Arşiv']);
const OPEN_TRANSFER_REQUEST_STATUSES = new Set(['Bekliyor', 'Onaylandı', 'Gerçekleştiriliyor']);
const TRANSFER_AUTOMATION_COOLDOWN_MS = 10 * 60 * 1000;
const TRANSFER_TERMINAL_STATUSES = new Set(['Tamamlandı', 'Hatalı İşlem', 'Reddedildi', 'İptal Edildi', 'Arşiv']);

const normalizeTransferStatusKey = (value) => String(value || '')
  .trim()
  .toLocaleLowerCase('tr-TR')
  .replace(/[ç]/g, 'c')
  .replace(/[ğ]/g, 'g')
  .replace(/[ı]/g, 'i')
  .replace(/[ö]/g, 'o')
  .replace(/[ş]/g, 's')
  .replace(/[ü]/g, 'u')
  .replace(/\s+/g, '_')
  .replace(/-/g, '_');

const TRANSFER_STATUS_ALIASES = {
  pending: 'Bekliyor',
  bekliyor: 'Bekliyor',
  queued: 'Sıraya Alındı',
  approved: 'Onaylandı',
  onaylandi: 'Onaylandı',
  siraya_alindi: 'Onaylandı',
  hazirlaniyor: 'Onaylandı',
  in_progress: 'Gerçekleştiriliyor',
  inprogress: 'Gerçekleştiriliyor',
  islemde: 'Gerçekleştiriliyor',
  gerceklestiriliyor: 'Gerçekleştiriliyor',
  completed: 'Tamamlandı',
  tamamlandi: 'Tamamlandı',
  failed: 'Hatalı İşlem',
  error: 'Hatalı İşlem',
  hatali_islem: 'Hatalı İşlem',
  rejected: 'Reddedildi',
  reddedildi: 'Reddedildi',
  cancelled: 'İptal Edildi',
  canceled: 'İptal Edildi',
  iptal: 'İptal Edildi',
  iptal_edildi: 'İptal Edildi',
  archived: 'Arşiv',
  arsiv: 'Arşiv',
};

const normalizeTransferStatus = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  return TRANSFER_STATUS_ALIASES[normalizeTransferStatusKey(normalized)] || normalized;
};

const resolvePriority = ({ requestedQuantity = 0, warehouseStock = 0, shelfStock = 0 } = {}) => {
  if (shelfStock <= 0 || requestedQuantity >= warehouseStock) return 'high';
  if (requestedQuantity >= Math.max(1, Math.floor(warehouseStock * 0.5))) return 'medium';
  return 'low';
};

const sortByNewest = (items) => [...items].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

const logTransferAudit = async ({ requestId, fromStatus = '', toStatus = '', note = '', actorId = '', actorName = '', event = 'status_changed', origin = 'manual' } = {}) => {
  const safeActorId = String(actorId || '').startsWith('system-') ? '' : actorId;
  await transferRequestAuditRepo.create({
    id: uuidv4(),
    transferRequestId: requestId,
    fromStatus,
    toStatus,
    note,
    actorId: safeActorId,
    actorName,
    event,
    origin,
    createdAt: new Date().toISOString(),
  });
};

const appendHistory = (rows = [], audits = []) => {
  const auditMap = new Map();
  audits.forEach((audit) => {
    const key = String(audit.transferRequestId || '');
    if (!key) return;
    const current = auditMap.get(key) || [];
    current.push(audit);
    auditMap.set(key, current);
  });

  return rows.map((row) => ({
    ...row,
    origin: row.origin || row.source || 'manual',
    source: row.source || row.origin || 'manual',
    history: (auditMap.get(String(row.id)) || [])
      .sort((left, right) => new Date(left.createdAt) - new Date(right.createdAt)),
  }));
};

const canTransitionTransferStatus = (fromStatus, toStatus) => {
  const from = normalizeTransferStatus(fromStatus) || 'Bekliyor';
  const to = normalizeTransferStatus(toStatus);
  if (!TRANSFER_REQUEST_STATUSES.has(to) || from === to) return false;
  if (from === 'Bekliyor' && ['Onaylandı', 'Reddedildi', 'İptal Edildi'].includes(to)) return true;
  if (from === 'Onaylandı' && ['Bekliyor', 'Gerçekleştiriliyor', 'Reddedildi', 'İptal Edildi'].includes(to)) return true;
  if (from === 'Gerçekleştiriliyor' && ['Onaylandı', 'Tamamlandı', 'Hatalı İşlem', 'İptal Edildi'].includes(to)) return true;
  if (from === 'Tamamlandı' && to === 'Arşiv') return true;
  return false;
};

const buildTransferPagination = (query = {}) => {
  const page = Math.max(1, Math.floor(Number(query.page || 1)));
  const limit = Math.min(100, Math.max(1, Math.floor(Number(query.limit || 25))));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

const attachListMeta = (items, meta) => {
  try {
    Object.defineProperty(items, 'meta', {
      value: meta,
      enumerable: false,
      configurable: true,
    });
  } catch {
    items.meta = meta;
  }
  return items;
};

const resolveAutomationQuantity = ({ product, stock }) => {
  const shelfStock = Number(stock?.shelfQuantity || 0);
  const warehouseStock = Number(stock?.warehouseQuantity || 0);
  if (warehouseStock <= 0) return 0;
  const criticalStock = Math.max(0, Number(product?.criticalStock || 0));
  const maxShelfStock = Math.max(0, Number(product?.maxShelfStock || product?.maxStock || 0));
  const targetShelf = maxShelfStock > 0
    ? maxShelfStock
    : Math.max(criticalStock * 2, shelfStock + 1);
  return Math.min(warehouseStock, Math.max(0, Math.ceil(targetShelf - shelfStock)));
};

const incrementCounter = (target, key) => {
  target[key] = Number(target[key] || 0) + 1;
};

const buildAutomationSkip = ({ product = {}, sectionId = '', reason, details = {} }) => ({
  productId: product.id || '',
  productName: product.name || '',
  sku: product.sku || '',
  sectionId: sectionId || product.sectionId || '',
  reason,
  ...details,
});

const TECHNICAL_ERROR_PATTERN = /(prisma|invocation|unknown argument|database|sql|constraint|foreign key|relation|stack|delegate|clientvalidationerror|repository)/i;

const isTechnicalError = (error) => {
  const message = String(error?.message || error || '');
  const name = String(error?.name || '');
  return TECHNICAL_ERROR_PATTERN.test(message) || /Prisma|ValidationError|TypeError|ReferenceError/i.test(name);
};

const toBulkReasonCode = (error, fallback = 'bulk_failed') => {
  const message = String(error?.message || '').toLowerCase();
  if (!message) return fallback;
  if (message.includes('kaynak stok') || message.includes('depo stok') || message.includes('parti stokları') || message.includes('mevcut stoktan fazla')) {
    return 'warehouse_stock_unavailable';
  }
  if (message.includes('pasif ürün')) return 'product_inactive';
  if (message.includes('ürün seçilen reyonda bulunamadı') || message.includes('reyon eşleşmesi')) return 'section_mapping_missing';
  if (message.includes('stok transfer') || message.includes('transfer miktarı')) {
    return 'stock_transfer_failed';
  }
  if (message.includes('geçersiz transfer durum geçişi')) return 'invalid_status_transition';
  if (message.includes('transfer talebi bulunamadı')) return 'not_found';
  if (isTechnicalError(error)) return 'system_error';
  return fallback;
};

const userMessageByReasonCode = (reasonCode) => {
  const messages = {
    not_found: 'Transfer talebi bulunamadı.',
    invalid_status_transition: 'Talep bu durumdan seçilen adıma geçirilemez.',
    already_processed: 'Talep zaten işlenmiş.',
    warehouse_stock_unavailable: 'Depo stok yetersiz.',
    product_inactive: 'Ürün pasif.',
    section_mapping_missing: 'Reyon eşleşmesi bulunamadı.',
    stock_transfer_failed: 'Stok transferi oluşturulamadı.',
    system_error: 'İşlem tamamlanamadı. Lütfen tekrar deneyin.',
    bulk_failed: 'Talep işlenemedi.',
  };
  return messages[reasonCode] || messages.bulk_failed;
};

const toUserFacingError = (error, fallbackCode = 'bulk_failed') => {
  const reasonCode = toBulkReasonCode(error, fallbackCode);
  return {
    reasonCode,
    userMessage: userMessageByReasonCode(reasonCode),
    debugMessage: String(error?.message || ''),
  };
};

const runLimitedGroups = async (groups = [], limit = 3, worker) => {
  const safeLimit = Math.max(1, Math.floor(Number(limit || 1)));
  let cursor = 0;
  const runners = Array.from({ length: Math.min(safeLimit, groups.length) }, async () => {
    while (cursor < groups.length) {
      const group = groups[cursor];
      cursor += 1;
      await worker(group);
    }
  });
  await Promise.all(runners);
};

const enrichSection = async (section) => {
  const [products, stocks] = await Promise.all([
    productRepo.getAll(),
    (await import('../repositories/stockRepository.js')).stockRepo.getAll(),
  ]);
  const sectionProducts = products.filter((p) => p.sectionId === section.id && isActiveRetailProduct(p));
  const stockMap = new Map(stocks.map((s) => [s.productId, s]));
  const shelfStockTotal = sectionProducts.reduce((sum, product) => sum + (stockMap.get(product.id)?.shelfQuantity || 0), 0);

  return {
    ...section,
    name: cleanSectionDisplayName(section.name, section.name || '-'),
    productCount: sectionProducts.length,
    shelfStockTotal,
  };
};

const fromDateValue = (value) => (value instanceof Date ? value.toISOString() : value ?? null);

const listSectionsFromPostgres = async () => {
  const tenantId = getActiveTenantId();
  const prisma = await getPrisma();
  const [sections, stockRows] = await withPostgresQueryLogging('GET /api/sections', () => Promise.all([
    prisma.section.findMany({
      orderBy: [{ number: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        number: true,
        name: true,
        description: true,
        isActive: true,
        payload: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { products: { where: { isListed: { not: false }, isActive: { not: false } } } } },
      },
    }),
    prisma.$queryRaw`
      SELECT p.section_id AS "sectionId",
             COALESCE(SUM(COALESCE(s.shelf_quantity, 0)), 0)::int AS "shelfStockTotal"
      FROM products p
      LEFT JOIN stocks s ON s.product_id = p.id AND s.tenant_id = p.tenant_id
      WHERE p.section_id IS NOT NULL
        AND p.is_listed IS NOT FALSE
        AND p.is_active IS NOT FALSE
        AND p.tenant_id = ${tenantId}
      GROUP BY p.section_id
    `,
  ]));
  const stockBySection = new Map((stockRows || []).map((row) => [String(row.sectionId), Number(row.shelfStockTotal || 0)]));

  return sections.map((section) => ({
    ...(section.payload && typeof section.payload === 'object' ? section.payload : {}),
    id: section.id,
    number: section.number,
    name: cleanSectionDisplayName(section.name, section.name || '-'),
    description: section.description,
    isActive: section.isActive !== false,
      productCount: section._count?.products || 0,
    shelfStockTotal: stockBySection.get(section.id) || 0,
    createdAt: fromDateValue(section.createdAt),
    updatedAt: fromDateValue(section.updatedAt),
  }));
};

export const sectionService = {
  async list() {
    if (config.dataStore === 'postgres') {
      return listSectionsFromPostgres();
    }

    const sections = await sectionRepo.getAll();
    return Promise.all(sections.map((s) => enrichSection(s)));
  },

  async getById(id) {
    const section = await sectionRepo.findById(id);
    if (!section) {
      throw createNotFoundError('Reyon bulunamadı');
    }
    return enrichSection(section);
  },

  async getProducts(id) {
    const section = await sectionRepo.findById(id);
    if (!section) {
      throw createNotFoundError('Reyon bulunamadı');
    }
    const [products, categories, stocks] = await Promise.all([
      productRepo.getAll(),
      (await import('../repositories/categoryRepository.js')).categoryRepo.getAll(),
      (await import('../repositories/stockRepository.js')).stockRepo.getAll(),
    ]);
    const catMap = new Map(categories.map((c) => [c.id, c]));
    const stockMap = new Map(stocks.map((s) => [s.productId, s]));

    return products
      .filter((p) => p.sectionId === id && isActiveRetailProduct(p))
      .map((p) => {
        const cat = catMap.get(p.categoryId);
        const stock = stockMap.get(p.id);
        const shelfStock = stock?.shelfQuantity || 0;
        const warehouseStock = stock?.warehouseQuantity || 0;
        const totalStock = shelfStock + warehouseStock;
        const qty = shelfStock;
        const isCritical = qty <= p.criticalStock;
        const stockWarning = isCritical ? 'Kritik' : (p.maxStock && qty <= p.maxStock * 0.25) ? 'Düşük' : 'Normal';
        return {
          ...p,
          categoryName: cat?.name || null,
          warehouseStock,
          shelfStock,
          totalStock,
          currentStock: qty,
          isCritical,
          stockWarning,
        };
      });
  },

  async create(payload) {
    validateSectionPayload(payload);
    const input = sanitizeSectionInput(payload);

    const existing = await sectionRepo.findByNumber(input.number);
    if (existing) {
      throw new AppError(409, 'Bu reyon numarası zaten mevcut');
    }

    const now = new Date().toISOString();
    const section = {
      id: uuidv4(),
      name: cleanSectionDisplayName(input.name, input.name),
      number: input.number,
      description: input.description,
      isActive: input.isActive,
      createdAt: now,
      updatedAt: now,
    };

    await sectionRepo.create(section);
    return enrichSection(section);
  },

  async createTransferRequest(sectionId, payload, requestUser) {
    const section = await sectionRepo.findById(sectionId);
    if (!section) {
      throw createNotFoundError('Reyon bulunamadı');
    }

    const productId = String(payload?.productId || '').trim();
    if (!productId) {
      throw new AppError(400, 'Ürün seçimi zorunludur');
    }

    const requestedQuantity = Number(payload?.quantity);
    if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0) {
      throw new AppError(400, 'Aktarılacak miktar sıfırdan büyük olmalıdır');
    }

    const product = await productRepo.findById(productId);
    if (!product || String(product.sectionId || '') !== String(sectionId || '')) {
      throw new AppError(400, 'Ürün seçilen reyonda bulunamadı');
    }

    const stock = await stockRepo.findByProductId(productId);
    const warehouseStock = Number(stock?.warehouseQuantity || 0);
    const shelfStock = Number(stock?.shelfQuantity || 0);

    if (requestedQuantity > warehouseStock) {
      throw new AppError(400, 'Depo stokundan fazla miktar talep edilemez');
    }

    const requester = await userRepo.findById(requestUser?.id);
    const now = new Date().toISOString();
    const origin = payload?.origin === 'automation' || payload?.source === 'automation' ? 'automation' : 'manual';

    const transferRequest = {
      id: uuidv4(),
      productId: product.id,
      productName: product.name,
      sku: product.sku,
      barcode: product.barcode || '',
      sectionId: section.id,
      sectionName: cleanSectionDisplayName(section.name, section.name),
      sectionNumber: section.number,
      sourceLocation: 'depo',
      targetLocation: 'reyon',
      quantity: requestedQuantity,
      warehouseStockSnapshot: warehouseStock,
      shelfStockSnapshot: shelfStock,
      status: 'Bekliyor',
      origin,
      source: origin,
      priority: resolvePriority({ requestedQuantity, warehouseStock, shelfStock }),
      requestedBy: origin === 'automation' ? '' : (requestUser?.id || ''),
      requestedByName: origin === 'automation' ? 'Otomasyon' : (requester?.name || requestUser?.name || 'Kullanıcı'),
      handledBy: '',
      handledByName: '',
      createdAt: now,
      completedAt: null,
      note: String(payload?.note || '').trim(),
      handledNote: '',
    };

    await transferRequestRepo.create(transferRequest);
    await logTransferAudit({
      requestId: transferRequest.id,
      fromStatus: '',
      toStatus: 'Bekliyor',
      note: transferRequest.note,
      actorId: transferRequest.requestedBy,
      actorName: transferRequest.requestedByName,
      event: origin === 'automation' ? 'automation_created' : 'created',
      origin,
    });
    return transferRequest;
  },

  async listTransferRequests(query = {}, requestUser) {
    const requestedStatusFilter = normalizeTransferStatus(query?.status);
    const statusFilter = TRANSFER_REQUEST_STATUSES.has(requestedStatusFilter) ? requestedStatusFilter : '';
    const priorityFilter = String(query?.priority || '').trim().toLowerCase();
    const sectionFilter = String(query?.sectionId || '').trim();
    const searchFilter = String(query?.search || '').trim();
    const startDate = String(query?.startDate || '').trim();
    const endDate = String(query?.endDate || '').trim();
    const pagination = buildTransferPagination(query);
    const includeHistory = String(query?.includeHistory ?? 'true').toLowerCase() !== 'false';
    const statusGroup = String(query?.statusGroup || '').trim().toLowerCase();
    const originFilter = String(query?.origin || query?.source || '').trim().toLowerCase();
    const requests = await transferRequestRepo.getAll();
    const audits = includeHistory ? await transferRequestAuditRepo.getAll() : [];
    const canViewAll = requestUser?.role === 'admin' || requestUser?.role === 'depo_personeli';

    const rowsWithSafeStatus = requests.map((item) => {
      const normalizedStatus = normalizeTransferStatus(item.status) || 'Bekliyor';
      const safeStatus = TRANSFER_REQUEST_STATUSES.has(normalizedStatus) ? normalizedStatus : 'Bekliyor';
      if (normalizedStatus && normalizedStatus !== safeStatus) {
        console.warn(`[transfer-requests] Unknown status "${item.status}" on request ${item.id}; falling back to Bekliyor`);
      }
      return { ...item, status: safeStatus, origin: item.origin || item.source || 'manual', source: item.source || item.origin || 'manual' };
    });

    const visibleRows = rowsWithSafeStatus.filter((item) => {
      const normalizedStatus = item.status;
      if (!canViewAll && item.requestedBy !== requestUser?.id) {
        return false;
      }
      if (statusFilter && normalizedStatus !== statusFilter) {
        return false;
      }
      if (statusGroup === 'active' && !OPEN_TRANSFER_REQUEST_STATUSES.has(normalizedStatus)) {
        return false;
      }
      if (statusGroup === 'archive' && !TRANSFER_TERMINAL_STATUSES.has(normalizedStatus)) {
        return false;
      }
      if (originFilter && String(item.origin || item.source || 'manual').toLowerCase() !== originFilter) {
        return false;
      }
      if (priorityFilter && String(item.priority || '').toLowerCase() !== priorityFilter) {
        return false;
      }
      if (sectionFilter && String(item.sectionId || '') !== sectionFilter) {
        return false;
      }
      if (searchFilter) {
        const matches = [item.productName, item.sku, item.barcode, item.sectionName, item.note]
          .filter(Boolean)
          .some((val) => includesSearchText(val, searchFilter));
        if (!matches) {
          return false;
        }
      }
      if (startDate) {
        const start = new Date(`${startDate}T00:00:00`);
        if (new Date(item.createdAt) < start) {
          return false;
        }
      }
      if (endDate) {
        const end = new Date(`${endDate}T23:59:59`);
        if (new Date(item.createdAt) > end) {
          return false;
        }
      }
      return true;
    });

    const sorted = sortByNewest(visibleRows);
    const pageRows = sorted.slice(pagination.skip, pagination.skip + pagination.limit);
    return attachListMeta(appendHistory(pageRows, audits), {
      pagination: {
        mode: 'offset',
        page: pagination.page,
        limit: pagination.limit,
        total: sorted.length,
        totalPages: Math.max(1, Math.ceil(sorted.length / pagination.limit)),
        hasNextPage: pagination.skip + pageRows.length < sorted.length,
        hasPreviousPage: pagination.page > 1,
      },
      filters: {
        status: statusFilter,
        statusGroup,
        priority: priorityFilter,
        sectionId: sectionFilter,
        search: searchFilter,
        origin: originFilter,
      },
    });
  },

  async updateTransferRequestStatus(requestId, payload, requestUser, options = {}) {
    const nextStatus = normalizeTransferStatus(payload?.status);
    if (!TRANSFER_REQUEST_STATUSES.has(nextStatus)) {
      throw new AppError(400, 'Geçersiz transfer talep durumu');
    }

    const existing = options.existingRequest || await transferRequestRepo.findById(requestId);
    if (!existing) {
      throw createNotFoundError('Transfer talebi bulunamadı');
    }

    const currentStatus = normalizeTransferStatus(existing.status) || 'Bekliyor';
    if (!canTransitionTransferStatus(currentStatus, nextStatus)) {
      throw new AppError(400, `Geçersiz transfer durum geçişi: ${currentStatus} -> ${nextStatus}`);
    }

    const handledNote = String(payload?.note || '').trim();
    const now = new Date().toISOString();
    const shouldComplete = nextStatus === 'Tamamlandı' && currentStatus !== 'Tamamlandı';

    let transferResult = null;
    if (shouldComplete) {
      try {
        transferResult = await stockService.transferStock({
          productId: existing.productId,
          qty: Number(existing.quantity),
          fromLocation: 'depo',
          toLocation: 'reyon',
          reasonCode: 'transfer_to_shelf',
        transferRequestId: existing.id,
        transferRequestStatus: 'Tamamlandı',
        note: `Transfer Talebi: ${existing.id}`,
        }, requestUser?.id, {
          product: options.product,
          user: options.handler,
          skipAutomationScan: Boolean(options.skipAutomationScan),
        });
      } catch (error) {
        const handler = options.handler || await userRepo.findById(requestUser?.id);
        const userFacing = toUserFacingError(error, 'stock_transfer_failed');
        await logTransferAudit({
          requestId: existing.id,
          fromStatus: currentStatus,
          toStatus: currentStatus,
          note: userFacing.userMessage,
          actorId: requestUser?.id || '',
          actorName: handler?.name || requestUser?.name || 'Kullanıcı',
          event: 'stock_transfer_failed',
          origin: existing.origin || existing.source || 'manual',
        });
        console.error('[transfer-request:stock-transfer-failed]', {
          requestId: existing.id,
          reasonCode: userFacing.reasonCode,
          message: userFacing.debugMessage,
          stack: error?.stack || '',
        });
        throw error;
      }
    }

    const handler = options.handler || await userRepo.findById(requestUser?.id);
    const shouldSetHandler = ['Onaylandı', 'Gerçekleştiriliyor', 'Tamamlandı', 'Hatalı İşlem', 'Reddedildi', 'İptal Edildi', 'Arşiv'].includes(nextStatus);
    const updated = {
      ...existing,
      status: nextStatus,
      handledBy: shouldSetHandler ? (requestUser?.id || existing.handledBy || '') : existing.handledBy,
      handledByName: shouldSetHandler ? (handler?.name || requestUser?.name || existing.handledByName || '') : existing.handledByName,
      completedAt: nextStatus === 'Tamamlandı' ? now : existing.completedAt,
      handledNote: handledNote || existing.handledNote || '',
      updatedAt: now,
      stockTransferredAt: nextStatus === 'Tamamlandı' ? now : existing.stockTransferredAt,
      transferMovementId: transferResult?.movement?.id || existing.transferMovementId,
    };

    await transferRequestRepo.updateById(requestId, updated);
    await logTransferAudit({
      requestId: existing.id,
      fromStatus: currentStatus,
      toStatus: nextStatus,
      note: handledNote,
      actorId: requestUser?.id || '',
      actorName: handler?.name || requestUser?.name || 'Kullanıcı',
      event: nextStatus === 'Tamamlandı' ? 'stock_transfer_completed' : 'status_changed',
      origin: existing.origin || existing.source || 'manual',
    });
    return { ...updated, transferResult };
  },

  async bulkUpdateTransferRequests(payload = {}, requestUser = {}) {
    const ids = Array.isArray(payload.ids) ? [...new Set(payload.ids.map((id) => String(id || '').trim()).filter(Boolean))] : [];
    const action = String(payload.action || '').trim().toLowerCase();
    const note = String(payload.note || '').trim();
    const statusByAction = {
      approve: 'Onaylandı',
      start: 'Gerçekleştiriliyor',
      complete: 'Tamamlandı',
      reject: 'Reddedildi',
      cancel: 'İptal Edildi',
      archive: 'Arşiv',
      back_to_pending: 'Bekliyor',
      back_to_approved: 'Onaylandı',
    };
    const targetStatus = statusByAction[action] || normalizeTransferStatus(payload.status);
    if (!ids.length) throw new AppError(400, 'Toplu işlem için talep seçilmelidir');
    if (!TRANSFER_REQUEST_STATUSES.has(targetStatus)) throw new AppError(400, 'Geçersiz toplu işlem');
    if (targetStatus === 'Tamamlandı' && action !== 'complete') {
      throw new AppError(400, 'Tamamlama işlemi yalnız güvenli stok transfer akışıyla yapılabilir');
    }

    if (action !== 'complete') {
      const startedAt = Date.now();
      const [allRequests, handler] = await Promise.all([
        transferRequestRepo.getAll(),
        userRepo.findById(requestUser?.id),
      ]);
      const requestMap = new Map(allRequests.map((request) => [String(request.id), request]));
      const actorName = handler?.name || requestUser?.name || 'Kullanıcı';
      const results = new Array(ids.length);
      const updates = [];
      const now = new Date().toISOString();

      ids.forEach((id, index) => {
        const existing = requestMap.get(id);
        if (!existing) {
          results[index] = {
            id,
            ok: false,
            reasonCode: 'not_found',
            userMessage: userMessageByReasonCode('not_found'),
          };
          return;
        }

        const currentStatus = normalizeTransferStatus(existing.status) || 'Bekliyor';
        if (!canTransitionTransferStatus(currentStatus, targetStatus)) {
          const reasonCode = TRANSFER_TERMINAL_STATUSES.has(currentStatus) ? 'already_processed' : 'invalid_status_transition';
          results[index] = {
            id,
            ok: false,
            status: currentStatus,
            productName: existing.productName || '',
            reasonCode,
            userMessage: userMessageByReasonCode(reasonCode),
          };
          return;
        }

        updates.push({ id, index, existing, currentStatus });
      });

      const runChunk = async (chunk) => Promise.all(chunk.map(async ({ id, index, existing, currentStatus }) => {
        try {
          const updated = {
            ...existing,
            status: targetStatus,
            handledBy: requestUser?.id || existing.handledBy || '',
            handledByName: actorName || existing.handledByName || '',
            completedAt: targetStatus === 'Tamamlandı' ? now : existing.completedAt,
            handledNote: note || existing.handledNote || '',
            updatedAt: now,
            stockTransferredAt: targetStatus === 'Tamamlandı' ? now : existing.stockTransferredAt,
          };
          await transferRequestRepo.updateById(id, updated);
          await logTransferAudit({
            requestId: id,
            fromStatus: currentStatus,
            toStatus: targetStatus,
            note: note || `Toplu işlem: ${targetStatus}`,
            actorId: requestUser?.id || '',
            actorName,
            event: targetStatus === 'Arşiv' ? 'archived' : 'status_changed',
            origin: existing.origin || existing.source || 'manual',
          });
          results[index] = { id, ok: true, item: updated };
        } catch (error) {
          const userFacing = toUserFacingError(error);
          console.error('[transfer-request:bulk-fast-item-failed]', {
            id,
            action,
            currentStatus,
            reasonCode: userFacing.reasonCode,
            message: userFacing.debugMessage,
            stack: error?.stack || '',
          });
          results[index] = {
            id,
            ok: false,
            status: currentStatus,
            productName: existing.productName || '',
            reasonCode: userFacing.reasonCode,
            userMessage: userFacing.userMessage,
          };
        }
      }));

      const chunkSize = 25;
      for (let index = 0; index < updates.length; index += chunkSize) {
        await runChunk(updates.slice(index, index + chunkSize));
      }

      const compactResults = results.filter(Boolean);
      return {
        action,
        targetStatus,
        successCount: compactResults.filter((item) => item.ok).length,
        failedCount: compactResults.filter((item) => !item.ok).length,
        durationMs: Date.now() - startedAt,
        results: compactResults,
      };
    }

    const startedAt = Date.now();
    const [allRequests, handler, products] = await Promise.all([
      transferRequestRepo.getAll(),
      userRepo.findById(requestUser?.id),
      productRepo.getAll(),
    ]);
    const requestMap = new Map(allRequests.map((request) => [String(request.id), request]));
    const productMap = new Map(products.map((product) => [String(product.id), product]));
    const results = new Array(ids.length);
    const workItems = [];
    const affectedProductIds = new Set();

    ids.forEach((id, index) => {
      const existing = requestMap.get(id);
      if (!existing) {
        results[index] = {
          id,
          ok: false,
          reasonCode: 'not_found',
          userMessage: userMessageByReasonCode('not_found'),
        };
        return;
      }
      const currentStatus = normalizeTransferStatus(existing.status) || 'Bekliyor';
      const normalizedProductId = String(existing.productId || '');
      workItems.push({ id, index, existing, currentStatus, productId: normalizedProductId });
    });

    const groupsByProduct = new Map();
    workItems.forEach((item) => {
      const key = item.productId || `request:${item.id}`;
      const group = groupsByProduct.get(key) || [];
      group.push(item);
      groupsByProduct.set(key, group);
    });

    const processItem = async ({ id, index, existing, currentStatus }) => {
      try {
        let requestForCompletion = existing;
        let statusBeforeCompletion = currentStatus;
        if (currentStatus === 'Onaylandı') {
          const now = new Date().toISOString();
          requestForCompletion = {
            ...existing,
            status: 'Gerçekleştiriliyor',
            handledBy: requestUser?.id || existing.handledBy || '',
            handledByName: handler?.name || requestUser?.name || existing.handledByName || '',
            handledNote: note || existing.handledNote || '',
            updatedAt: now,
          };
          await transferRequestRepo.updateById(id, requestForCompletion);
          await logTransferAudit({
            requestId: id,
            fromStatus: currentStatus,
            toStatus: 'Gerçekleştiriliyor',
            note: note || 'Toplu tamamlama için işleme alındı',
            actorId: requestUser?.id || '',
            actorName: handler?.name || requestUser?.name || 'Kullanıcı',
            event: 'status_changed',
            origin: existing.origin || existing.source || 'manual',
          });
          statusBeforeCompletion = 'Gerçekleştiriliyor';
        }
        const latest = await this.updateTransferRequestStatus(id, { status: targetStatus, note: note || `Toplu işlem: ${targetStatus}` }, requestUser, {
          existingRequest: requestForCompletion,
          handler,
          product: productMap.get(String(requestForCompletion.productId || '')),
          skipAutomationScan: true,
        });
        affectedProductIds.add(String(latest.productId || requestForCompletion.productId || ''));
        results[index] = { id, ok: true, item: latest };
      } catch (error) {
        const userFacing = toUserFacingError(error);
        console.error('[transfer-request:bulk-item-failed]', {
          id,
          action,
          currentStatus,
          reasonCode: userFacing.reasonCode,
          message: userFacing.debugMessage,
          stack: error?.stack || '',
        });
        results[index] = {
          id,
          ok: false,
          status: currentStatus,
          productName: existing.productName || '',
          reasonCode: userFacing.reasonCode,
          userMessage: userFacing.userMessage,
        };
      }
    };

    await runLimitedGroups([...groupsByProduct.values()], 3, async (group) => {
      for (const item of group) {
        await processItem(item);
      }
    });

    const affectedProducts = [...affectedProductIds].filter(Boolean);
    let automationScan = null;
    if (affectedProducts.length > 0) {
      automationScan = await this.runTransferAutomationScan({
        source: 'bulk_stock_transfer',
        productIds: affectedProducts,
      });
    }

    const compactResults = results.filter(Boolean);
    return {
      action,
      targetStatus,
      successCount: compactResults.filter((item) => item.ok).length,
      failedCount: compactResults.filter((item) => !item.ok).length,
      durationMs: Date.now() - startedAt,
      concurrency: 3,
      automationScan: automationScan ? {
        checkedCount: automationScan.checkedCount,
        createdCount: automationScan.createdCount,
        skippedCount: automationScan.skippedCount,
      } : null,
      results: compactResults,
    };
  },

  async runTransferAutomationScan(options = {}) {
    const now = new Date();
    const nowIso = now.toISOString();
    const actor = { id: 'system-automation', name: 'Otomasyon' };
    const source = String(options?.source || 'manual').trim() || 'manual';
    const targetProductId = String(options?.productId || '').trim();
    const targetProductIds = new Set(Array.isArray(options?.productIds)
      ? options.productIds.map((id) => String(id || '').trim()).filter(Boolean)
      : []);
    const [sections, products, stocks, requests] = await Promise.all([
      sectionRepo.getAll(),
      productRepo.getAll(),
      stockRepo.getAll(),
      transferRequestRepo.getAll(),
    ]);
    const sectionMap = new Map(sections.map((section) => [String(section.id), section]));
    const stockMap = new Map(stocks.map((stock) => [String(stock.productId), stock]));

    const openAutoKeys = new Set(requests
      .filter((request) => OPEN_TRANSFER_REQUEST_STATUSES.has(normalizeTransferStatus(request.status)))
      .map((request) => {
        const type = request.targetLocationType || request.payload?.transferTarget?.targetLocationType || 'physical_shelf';
        return `${String(request.productId || '')}:${type}`;
      }));

    const recentAutoKeys = new Set(requests
      .filter((request) => String(request.origin || request.source || '').toLowerCase() === 'automation')
      .filter((request) => !OPEN_TRANSFER_REQUEST_STATUSES.has(normalizeTransferStatus(request.status)))
      .filter((request) => {
        const createdAt = new Date(request.createdAt || 0).getTime();
        return Number.isFinite(createdAt) && now.getTime() - createdAt < TRANSFER_AUTOMATION_COOLDOWN_MS;
      })
      .map((request) => {
        const type = request.targetLocationType || request.payload?.transferTarget?.targetLocationType || 'physical_shelf';
        return `${String(request.productId || '')}:${type}`;
      }));

    const created = [];
    const skipped = [];
    const summary = {
      source,
      checkedCount: 0,
      eligibleCount: 0,
      belowThresholdCount: 0,
      createdCount: 0,
      skippedCount: 0,
      skippedByReason: {},
      openDuplicateCount: 0,
      cooldownCount: 0,
      warehouseStockUnavailableCount: 0,
      productSectionMissingCount: 0,
      inactiveProductCount: 0,
      inactiveSectionCount: 0,
      notBelowThresholdCount: 0,
    };

    const skip = (entry) => {
      skipped.push(entry);
      summary.skippedCount += 1;
      incrementCounter(summary.skippedByReason, entry.reason);
      if (entry.reason === 'open_request_exists') summary.openDuplicateCount += 1;
      if (entry.reason === 'cooldown') summary.cooldownCount += 1;
      if (entry.reason === 'warehouse_stock_unavailable') summary.warehouseStockUnavailableCount += 1;
      if (entry.reason === 'product_section_missing') summary.productSectionMissingCount += 1;
      if (entry.reason === 'inactive_or_unlisted_product') summary.inactiveProductCount += 1;
      if (entry.reason === 'inactive_section') summary.inactiveSectionCount += 1;
      if (entry.reason === 'not_below_threshold') summary.notBelowThresholdCount += 1;
    };

    for (const product of products) {
      if (targetProductId && String(product.id || '') !== targetProductId) continue;
      if (targetProductIds.size > 0 && !targetProductIds.has(String(product.id || ''))) continue;
      summary.checkedCount += 1;
      if (!isActiveRetailProduct(product)) {
        skip(buildAutomationSkip({ product, reason: 'inactive_or_unlisted_product' }));
        continue;
      }
      if (!product.sectionId) {
        skip(buildAutomationSkip({ product, reason: 'product_section_missing' }));
        continue;
      }
      const section = sectionMap.get(String(product.sectionId));
      if (!section) {
        skip(buildAutomationSkip({ product, reason: 'product_section_missing' }));
        continue;
      }
      if (section.isActive === false) {
        skip(buildAutomationSkip({ product, sectionId: section.id, reason: 'inactive_section' }));
        continue;
      }
      summary.eligibleCount += 1;
      const stock = stockMap.get(String(product.id)) || { warehouseQuantity: 0, shelfQuantity: 0 };
      const shelfQty = Number(stock.shelfQuantity || 0);
      const critical = Number(product.criticalStock || 0);
      const warehouseStock = Number(stock.warehouseQuantity || 0);

      const isBelowCritical = critical > 0 && shelfQty <= critical;
      const isEmptyWithoutCritical = critical <= 0 && shelfQty <= 0;
      const needsReplenishment = warehouseStock > 0 && (isBelowCritical || isEmptyWithoutCritical);

      if (!needsReplenishment) {
        skip(buildAutomationSkip({
          product,
          sectionId: section.id,
          reason: 'not_below_threshold',
          details: { shelfStock: shelfQty, criticalStock: critical, warehouseStock },
        }));
        continue;
      }
      summary.belowThresholdCount += 1;

      const descriptor = resolveTransferTargetDescriptor({ product, section });
      const targetLocationType = descriptor.targetLocationType || 'physical_shelf';
      const key = `${product.id}:${targetLocationType}`;

      if (openAutoKeys.has(key)) {
        skip(buildAutomationSkip({
          product,
          sectionId: section.id,
          reason: 'open_request_exists',
          details: { shelfStock: shelfQty, criticalStock: critical, targetLocationType },
        }));
        continue;
      }
      if (shelfQty > 0 && recentAutoKeys.has(key)) {
        skip(buildAutomationSkip({
          product,
          sectionId: section.id,
          reason: 'cooldown',
          details: { shelfStock: shelfQty, criticalStock: critical, targetLocationType, cooldownMs: TRANSFER_AUTOMATION_COOLDOWN_MS },
        }));
        continue;
      }
      const quantity = resolveAutomationQuantity({ product, stock });
      if (quantity <= 0) {
        skip(buildAutomationSkip({
          product,
          sectionId: section.id,
          reason: 'warehouse_stock_unavailable',
          details: { shelfStock: shelfQty, criticalStock: critical, warehouseStock },
        }));
        continue;
      }
      const request = await this.createTransferRequest(section.id, {
        productId: product.id,
        quantity,
        origin: 'automation',
        source: 'automation',
        note: `Otomatik reyon besleme: reyon stoğu ${shelfQty}, kritik eşik ${critical || 0}. ${nowIso}`,
      }, actor);
      created.push(request);
      summary.createdCount += 1;
      openAutoKeys.add(key);
      recentAutoKeys.add(key);
    }

    const result = {
      ...summary,
      created,
      skipped,
      scannedAt: nowIso,
    };
    console.info('[transfer-automation:scan]', {
      source,
      checkedCount: result.checkedCount,
      eligibleCount: result.eligibleCount,
      belowThresholdCount: result.belowThresholdCount,
      createdCount: result.createdCount,
      skippedCount: result.skippedCount,
      skippedByReason: result.skippedByReason,
    });
    return result;
  },

  async update(id, payload) {
    validateSectionPayload(payload, { partial: true });

    const existing = await sectionRepo.findById(id);
    if (!existing) {
      throw createNotFoundError('Reyon bulunamadı');
    }

    const input = sanitizeSectionInput({ ...existing, ...payload });

    const sameNumber = await sectionRepo.findByNumber(input.number);
    if (sameNumber && sameNumber.id !== id) {
      throw new AppError(409, 'Bu reyon numarası zaten mevcut');
    }

    const updated = {
      ...existing,
      name: cleanSectionDisplayName(input.name, input.name),
      number: input.number,
      description: input.description,
      isActive: input.isActive,
      updatedAt: new Date().toISOString(),
    };

    await sectionRepo.updateById(id, updated);
    return enrichSection(updated);
  },

  async remove(id) {
    const existing = await sectionRepo.findById(id);
    if (!existing) {
      throw createNotFoundError('Reyon bulunamadı');
    }

    const products = await productRepo.getAll();
    if (products.some((p) => p.sectionId === id)) {
      throw new AppError(400, 'Ürün bağlı olan reyon silinemez');
    }

    await sectionRepo.deleteById(id);
    return existing;
  },
};

