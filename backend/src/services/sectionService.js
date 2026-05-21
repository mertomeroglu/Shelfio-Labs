import { v4 as uuidv4 } from 'uuid';
import { createFileRepository } from '../repositories/fileRepository.js';
import { sectionRepo } from '../repositories/sectionRepository.js';
import { productRepo } from '../repositories/productRepository.js';
import { stockRepo } from '../repositories/stockRepository.js';
import { userRepo } from '../repositories/userRepository.js';
import { stockService } from './stockService.js';
import { AppError, createNotFoundError } from '../utils/appError.js';
import { sanitizeSectionInput, validateSectionPayload } from '../utils/validators.js';
import { config } from '../config/config.js';
import { getPrisma } from '../providers/postgresProvider.js';
import { withPostgresQueryLogging } from '../utils/performanceLogger.js';
import { isActiveRetailProduct } from '../utils/retailStockPolicy.js';

const transferRequestRepo = createFileRepository({ fileName: 'stockTransferRequests.json', defaultData: [] });
const transferRequestAuditRepo = createFileRepository({ fileName: 'stockTransferRequestAudits.json', defaultData: [] });

const TRANSFER_REQUEST_STATUSES = new Set(['Bekliyor', 'Sıraya Alındı', 'Gerçekleştiriliyor', 'Tamamlandı', 'Hatalı İşlem', 'Reddedildi', 'Arşiv']);

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
  approved: 'Sıraya Alındı',
  onaylandi: 'Sıraya Alındı',
  siraya_alindi: 'Sıraya Alındı',
  hazirlaniyor: 'Sıraya Alındı',
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
  cancelled: 'Reddedildi',
  canceled: 'Reddedildi',
  iptal: 'Reddedildi',
  iptal_edildi: 'Reddedildi',
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

const logTransferAudit = async ({ requestId, fromStatus = '', toStatus = '', note = '', actorId = '', actorName = '' } = {}) => {
  await transferRequestAuditRepo.create({
    id: uuidv4(),
    transferRequestId: requestId,
    fromStatus,
    toStatus,
    note,
    actorId,
    actorName,
    createdAt: new Date().toISOString(),
  });
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
    productCount: sectionProducts.length,
    shelfStockTotal,
  };
};

const fromDateValue = (value) => (value instanceof Date ? value.toISOString() : value ?? null);

const listSectionsFromPostgres = async () => {
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
      LEFT JOIN stocks s ON s.product_id = p.id
      WHERE p.section_id IS NOT NULL
        AND p.is_listed IS NOT FALSE
        AND p.is_active IS NOT FALSE
      GROUP BY p.section_id
    `,
  ]));
  const stockBySection = new Map((stockRows || []).map((row) => [String(row.sectionId), Number(row.shelfStockTotal || 0)]));

  return sections.map((section) => ({
    ...(section.payload && typeof section.payload === 'object' ? section.payload : {}),
    id: section.id,
    number: section.number,
    name: section.name,
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
      name: input.name,
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
    if (!product || product.sectionId !== sectionId) {
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

    const transferRequest = {
      id: uuidv4(),
      productId: product.id,
      productName: product.name,
      sku: product.sku,
      barcode: product.barcode || '',
      sectionId: section.id,
      sectionName: section.name,
      sectionNumber: section.number,
      sourceLocation: 'depo',
      targetLocation: 'reyon',
      quantity: requestedQuantity,
      warehouseStockSnapshot: warehouseStock,
      shelfStockSnapshot: shelfStock,
      status: 'Bekliyor',
      priority: resolvePriority({ requestedQuantity, warehouseStock, shelfStock }),
      requestedBy: requestUser?.id || '',
      requestedByName: requester?.name || requestUser?.name || 'Kullanıcı',
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
    });
    return transferRequest;
  },

  async listTransferRequests(query = {}, requestUser) {
    const requestedStatusFilter = normalizeTransferStatus(query?.status);
    const statusFilter = TRANSFER_REQUEST_STATUSES.has(requestedStatusFilter) ? requestedStatusFilter : '';
    const priorityFilter = String(query?.priority || '').trim().toLowerCase();
    const sectionFilter = String(query?.sectionId || '').trim();
    const searchFilter = String(query?.search || '').trim().toLowerCase();
    const startDate = String(query?.startDate || '').trim();
    const endDate = String(query?.endDate || '').trim();
    const requests = await transferRequestRepo.getAll();
    const canViewAll = requestUser?.role === 'admin' || requestUser?.role === 'depo_personeli';

    const rowsWithSafeStatus = requests.map((item) => {
      const normalizedStatus = normalizeTransferStatus(item.status) || 'Bekliyor';
      const safeStatus = TRANSFER_REQUEST_STATUSES.has(normalizedStatus) ? normalizedStatus : 'Bekliyor';
      if (normalizedStatus && normalizedStatus !== safeStatus) {
        console.warn(`[transfer-requests] Unknown status "${item.status}" on request ${item.id}; falling back to Bekliyor`);
      }
      return { ...item, status: safeStatus };
    });

    const visibleRows = rowsWithSafeStatus.filter((item) => {
      const normalizedStatus = item.status;
      if (!canViewAll && item.requestedBy !== requestUser?.id) {
        return false;
      }
      if (statusFilter && normalizedStatus !== statusFilter) {
        return false;
      }
      if (priorityFilter && String(item.priority || '').toLowerCase() !== priorityFilter) {
        return false;
      }
      if (sectionFilter && String(item.sectionId || '') !== sectionFilter) {
        return false;
      }
      if (searchFilter) {
        const haystack = [item.productName, item.sku, item.barcode, item.sectionName, item.note]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(searchFilter)) {
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

    return sortByNewest(visibleRows);
  },

  async updateTransferRequestStatus(requestId, payload, requestUser) {
    const nextStatus = normalizeTransferStatus(payload?.status);
    if (!TRANSFER_REQUEST_STATUSES.has(nextStatus)) {
      throw new AppError(400, 'Geçersiz transfer talep durumu');
    }

    const existing = await transferRequestRepo.findById(requestId);
    if (!existing) {
      throw createNotFoundError('Transfer talebi bulunamadı');
    }

    const currentStatus = normalizeTransferStatus(existing.status) || 'Bekliyor';

    const handledNote = String(payload?.note || '').trim();
    const now = new Date().toISOString();
    const shouldComplete = nextStatus === 'Tamamlandı' && currentStatus !== 'Tamamlandı';

    if (shouldComplete) {
      await stockService.transferStock({
        productId: existing.productId,
        qty: Number(existing.quantity),
        fromLocation: 'depo',
        toLocation: 'reyon',
        reasonCode: 'transfer_to_shelf',
        transferRequestId: existing.id,
        transferRequestStatus: 'Tamamlandı',
        note: `Transfer Talebi: ${existing.id}`,
      }, requestUser?.id);
    }

    const handler = await userRepo.findById(requestUser?.id);
    const shouldSetHandler = ['Sıraya Alındı', 'Gerçekleştiriliyor', 'Tamamlandı', 'Hatalı İşlem', 'Reddedildi', 'Arşiv'].includes(nextStatus);
    const updated = {
      ...existing,
      status: nextStatus,
      handledBy: shouldSetHandler ? (requestUser?.id || existing.handledBy || '') : existing.handledBy,
      handledByName: shouldSetHandler ? (handler?.name || requestUser?.name || existing.handledByName || '') : existing.handledByName,
      completedAt: nextStatus === 'Tamamlandı' ? now : existing.completedAt,
      handledNote: handledNote || existing.handledNote || '',
      updatedAt: now,
    };

    await transferRequestRepo.updateById(requestId, updated);
    await logTransferAudit({
      requestId: existing.id,
      fromStatus: currentStatus,
      toStatus: nextStatus,
      note: handledNote,
      actorId: requestUser?.id || '',
      actorName: handler?.name || requestUser?.name || 'Kullanıcı',
    });
    return updated;
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
      name: input.name,
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

