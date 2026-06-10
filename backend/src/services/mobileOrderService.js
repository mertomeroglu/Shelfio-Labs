import crypto from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';
import { getPrisma } from '../providers/postgresProvider.js';
import { config } from '../config/config.js';
import { MAIN_STORE_ID, MAIN_TENANT_ID, getActiveStoreId, getActiveTenantId, runWithTenantContext } from '../tenant/tenantContext.js';
import { AppError, createNotFoundError } from '../utils/appError.js';
import { customerRepo } from '../repositories/customerRepository.js';
import { customerOrderRepo } from '../repositories/customerOrderRepository.js';
import { auditLogService } from './auditLogService.js';
import { applyCampaignPricingToProduct, listActiveCampaignDefinitions } from './campaignPricingService.js';

export const MOBILE_ORDER_STATUS = {
  PENDING_CASHIER: 'pending_cashier',
  PULLED_TO_POS: 'pulled_to_pos',
  CUSTOMER_CONFIRMED_HANDOFF: 'customer_confirmed_handoff',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  EXPIRED: 'expired',
};

const MOBILE_ORDER_TTL_MINUTES = 30;
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const lookupHits = new Map();

const toNumber = (value) => {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'object' && typeof value.toNumber === 'function') return value.toNumber();
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
};

const roundMoney = (value) => Math.round(toNumber(value) * 100) / 100;
const normalizeCode = (value) => String(value || '').trim().toUpperCase().replace(/\s+/g, '');
const hashToken = (value) => crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
const createRawToken = () => crypto.randomBytes(24).toString('base64url');

const createShortCode = () => {
  let body = '';
  for (let i = 0; i < 6; i += 1) {
    body += CODE_ALPHABET[crypto.randomInt(0, CODE_ALPHABET.length)];
  }
  return `MBL-${body}`;
};

const buildNextMobileDisplayOrderNo = async (tenantId) => {
  const todayKey = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const todayPrefix = `${todayKey.slice(0, 4)}-${todayKey.slice(4, 6)}-${todayKey.slice(6, 8)}`;

  let customerOrderCount = 0;
  let mobileOrderCount = 0;

  if (config.dataStore === 'postgres') {
    const prisma = await getPrisma();
    const todayStart = new Date(`${todayPrefix}T00:00:00.000Z`);
    const todayEnd = new Date(`${todayPrefix}T23:59:59.999Z`);

    const [cCount, mCount] = await Promise.all([
      runWithTenantContext({ tenantId }, () => prisma.customerOrder.count({
        where: { tenantId, createdAt: { gte: todayStart, lte: todayEnd } },
      })),
      runWithTenantContext({ tenantId }, () => prisma.mobileOrder.count({
        where: { tenantId, createdAt: { gte: todayStart, lte: todayEnd } },
      })),
    ]);
    customerOrderCount = cCount;
    mobileOrderCount = mCount;
  } else {
    const prisma = await getPrisma();
    const [customerOrders, mCount] = await Promise.all([
      customerOrderRepo.getAll(),
      runWithTenantContext({ tenantId }, () => prisma.mobileOrder.count({
        where: { tenantId, createdAt: { gte: new Date(`${todayPrefix}T00:00:00.000Z`) } },
      })),
    ]);
    customerOrderCount = customerOrders.filter((row) => String(row?.createdAt || '').startsWith(todayPrefix)).length;
    mobileOrderCount = mCount;
  }

  return `MOB-${todayKey}-${String(customerOrderCount + mobileOrderCount + 1).padStart(4, '0')}`;
};

const parseLookupCode = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw);
    return normalizeCode(parsed?.code || parsed?.token || raw);
  } catch {
    return normalizeCode(raw);
  }
};

const normalizeCartItems = (customer = {}, payload = {}) => {
  const cart = customer.activeCart || customer.cart || customer.currentCart || null;
  const cartItems = Array.isArray(cart?.items) ? cart.items : [];
  const selectedIds = new Set(
    (Array.isArray(payload?.selectedProductIds) ? payload.selectedProductIds : [])
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  );

  return cartItems
    .filter((item) => !selectedIds.size || selectedIds.has(String(item?.productId || item?.id || '')))
    .map((item) => {
      const productId = String(item?.productId || item?.id || '').trim();
      const quantity = Math.max(1, Math.floor(Number(item?.quantity || 1)));
      if (!productId || !Number.isFinite(quantity)) return null;
      return {
        productId,
        quantity,
        productName: String(item?.productName || item?.name || '').trim(),
        unit: String(item?.unit || 'adet').trim() || 'adet',
        unitPrice: roundMoney(item?.unitPrice ?? item?.price ?? 0),
      };
    })
    .filter(Boolean);
};

export const subtractCompletedCartItems = (currentItems = [], completedItems = []) => {
  const completedQuantityByProductId = new Map(
    completedItems.map((item) => [
      String(item?.productId || ''),
      Math.max(0, Number(item?.quantity || 0)),
    ])
  );

  return currentItems
    .map((item) => {
      const productId = String(item?.productId || item?.id || '');
      const completedQuantity = completedQuantityByProductId.get(productId) || 0;
      const remainingQuantity = Math.max(0, Number(item?.quantity || 0) - completedQuantity);
      return remainingQuantity > 0 ? { ...item, quantity: remainingQuantity } : null;
    })
    .filter(Boolean);
};

const removeCompletedItemsFromCart = async (customerId, completedItems = []) => {
  const updatedCustomer = await customerRepo.updateById(customerId, (current) => {
    const currentItems = Array.isArray(current?.activeCart?.items) ? current.activeCart.items : [];
    const remainingItems = subtractCompletedCartItems(currentItems, completedItems);

    return {
      ...current,
      activeCart: remainingItems.length > 0 ? {
        ...(current?.activeCart || {}),
        id: current?.activeCart?.id || `cart-${customerId}`,
        items: remainingItems,
        status: 'active',
        updatedAt: new Date().toISOString(),
      } : null,
      updatedAt: new Date().toISOString(),
    };
  });
  if (!updatedCustomer) {
    throw createNotFoundError('Müşteri bulunamadı');
  }
  return updatedCustomer;
};

const retryCartCleanup = async (customerId, completedItems, attempts = 3) => {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await removeCompletedItemsFromCart(customerId, completedItems);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
};

export const buildCustomerOrderFromMobileOrder = (order = {}, options = {}) => {
  const now = options.now || new Date().toISOString();
  const displayOrderNo = String(options.displayOrderNo || order.payload?.displayOrderNo || order.payload?.orderNo || order.code || '').trim();
  const pricingByProductId = order.payload?.itemPricing && typeof order.payload.itemPricing === 'object'
    ? order.payload.itemPricing
    : {};
  const customerOrderId = String(options.customerOrderId || order.payload?.customerOrderId || `mobile-order-${order.id}`);
  const items = (Array.isArray(order.items) ? order.items : []).map((item) => {
    const pricing = pricingByProductId[item.productId] || {};
    const quantity = Number(item.quantity || 0);
    const unitPrice = roundMoney(item.unitPriceSnapshot);
    const regularUnitPrice = roundMoney(pricing.regularPrice || unitPrice);
    return {
      productId: item.productId,
      productName: item.productNameSnapshot,
      sku: item.sku || '',
      barcode: item.barcode || '',
      quantity,
      unitPrice,
      totalPrice: roundMoney(item.totalPriceSnapshot || unitPrice * quantity),
      regularUnitPrice,
      discountAmount: roundMoney(Math.max(0, regularUnitPrice - unitPrice) * quantity),
      campaignName: pricing.campaignInfo || pricing.activeCampaignName || '',
      hasActiveCampaign: pricing.hasActiveCampaign === true,
    };
  });

  return {
    id: customerOrderId,
    orderNo: displayOrderNo,
    customerId: order.customerId,
    status: 'kasaya_aktarildi',
    totalAmount: roundMoney(order.totalSnapshot),
    createdAt: order.createdAt?.toISOString?.() || order.createdAt || now,
    updatedAt: now,
    items,
    payload: {
      source: 'mobile_order_handoff',
      mobileOrderId: order.id,
      mobileOrderCode: order.code,
      mobileOrderStatus: options.status || order.status,
      mobileOrderExpiresAt: order.expiresAt?.toISOString?.() || order.expiresAt || null,
      displayOrderNo,
      orderNo: displayOrderNo,
      customer: {
        id: order.customerId,
        name: order.customer?.name || '',
        phone: order.customer?.phone || '',
        email: order.customer?.email || '',
      },
      pricingSnapshot: {
        subtotal: roundMoney(order.subtotalSnapshot),
        total: roundMoney(order.totalSnapshot),
        discount: roundMoney(items.reduce((sum, item) => sum + item.discountAmount, 0)),
      },
      note: 'Ödeme kasada tamamlanacak.',
    },
  };
};

const resolveCustomerTenantId = (customer = {}) => customer.tenantId || MAIN_TENANT_ID;

const resolveStoreId = async (tenantId) => {
  const prisma = await getPrisma();
  const store = await runWithTenantContext({ tenantId }, () => prisma.store.findFirst({
    where: { tenantId, status: 'active' },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  }));
  return store?.id || MAIN_STORE_ID;
};

const mapPricedProduct = (product, activeCampaigns = []) => {
  const salePrice = toNumber(product.salePrice);
  const stockQuantity = Number(product.stock?.shelfQuantity ?? product.stock?.quantity ?? 0) || 0;
  const priced = applyCampaignPricingToProduct({
    id: product.id,
    productId: product.id,
    name: product.name,
    sku: product.sku,
    barcode: product.barcode,
    categoryId: product.categoryId || '',
    brand: product.brand || '',
    salePrice,
    price: salePrice,
  }, activeCampaigns, { includeGeneralCampaigns: true, channel: 'pos', audience: 'customer' });

  const unitPrice = roundMoney(priced.effectivePrice || priced.currentPrice || priced.salePrice || salePrice);
  return {
    productId: product.id,
    name: product.name,
    sku: product.sku || '',
    barcode: product.barcode || '',
    categoryId: product.categoryId || '',
    unit: product.unit || 'adet',
    unitPrice,
    salePrice: roundMoney(priced.salePrice || salePrice),
    currentPrice: unitPrice,
    effectivePrice: unitPrice,
    regularPrice: roundMoney(priced.regularPrice || salePrice),
    discountedPrice: priced.discountedPrice ? roundMoney(priced.discountedPrice) : null,
    hasActiveDiscount: priced.hasActiveDiscount === true,
    hasActiveCampaign: priced.hasActiveCampaign === true || priced.hasActiveDiscount === true,
    activeCampaignName: priced.activeCampaignName || priced.activeCampaign?.name || '',
    campaignInfo: priced.campaignInfo || priced.activeCampaignName || '',
    currentStock: stockQuantity,
    isAvailable: product.isActive !== false && product.isListed !== false && stockQuantity > 0,
  };
};

const getCurrentProductRows = async (tenantId, productIds = []) => {
  const prisma = await getPrisma();
  const activeCampaigns = await listActiveCampaignDefinitions();
  const rows = await runWithTenantContext({ tenantId }, () => prisma.product.findMany({
    where: { id: { in: productIds }, isActive: { not: false }, isListed: { not: false } },
    select: {
      id: true,
      name: true,
      sku: true,
      barcode: true,
      categoryId: true,
      brand: true,
      unit: true,
      salePrice: true,
      isActive: true,
      isListed: true,
      stock: { select: { shelfQuantity: true, quantity: true } },
    },
  }));
  return new Map(rows.map((row) => [row.id, mapPricedProduct(row, activeCampaigns)]));
};

const buildPublicOrder = async (order, { includeItems = true, includeValidation = false } = {}) => {
  const items = Array.isArray(order?.items) ? order.items : [];
  const displayOrderNo = String(
    order?.payload?.displayOrderNo
    || order?.payload?.orderNo
    || order?.orderNo
    || ''
  ).trim();
  const currentProducts = includeValidation
    ? await getCurrentProductRows(order.tenantId || MAIN_TENANT_ID, items.map((item) => item.productId).filter(Boolean))
    : new Map();
  let hasPriceChanges = false;
  let hasStockWarnings = false;

  const mappedItems = items.map((item) => {
    const current = currentProducts.get(item.productId);
    const snapshotUnitPrice = roundMoney(item.unitPriceSnapshot);
    const currentUnitPrice = current ? roundMoney(current.unitPrice) : snapshotUnitPrice;
    const quantity = Number(item.quantity || 0);
    const priceChanged = current ? Math.abs(currentUnitPrice - snapshotUnitPrice) > 0.01 : false;
    const stockStatus = !current
      ? 'unavailable'
      : current.currentStock <= 0
        ? 'out_of_stock'
        : current.currentStock < quantity
          ? 'insufficient'
          : 'available';
    hasPriceChanges = hasPriceChanges || priceChanged;
    hasStockWarnings = hasStockWarnings || stockStatus !== 'available';
    return {
      id: item.id,
      productId: item.productId,
      productName: current?.name || item.productNameSnapshot || '',
      name: current?.name || item.productNameSnapshot || '',
      sku: current?.sku || item.sku || '',
      barcode: current?.barcode || item.barcode || '',
      quantity,
      unitPriceSnapshot: snapshotUnitPrice,
      unitPrice: currentUnitPrice,
      totalPrice: roundMoney(currentUnitPrice * quantity),
      currentStock: current?.currentStock ?? 0,
      stockStatus,
      priceChanged,
      hasActiveCampaign: current?.hasActiveCampaign === true,
      campaignInfo: current?.campaignInfo || '',
    };
  });

  return {
    id: order.id,
    orderNo: displayOrderNo || order.code,
    displayOrderNo: displayOrderNo || order.code,
    code: order.code,
    status: order.status,
    customerId: order.customerId,
    customerName: order.customer?.name || null,
    customerPhone: order.customer?.phone || null,
    itemCount: Number(order.itemCount || mappedItems.length),
    subtotalSnapshot: roundMoney(order.subtotalSnapshot),
    totalSnapshot: roundMoney(order.totalSnapshot),
    expiresAt: order.expiresAt?.toISOString?.() || order.expiresAt,
    createdAt: order.createdAt?.toISOString?.() || order.createdAt,
    pulledAt: order.pulledAt?.toISOString?.() || order.pulledAt,
    completedAt: order.completedAt?.toISOString?.() || order.completedAt,
    qrPayload: JSON.stringify({ type: 'mobile_order_handoff', code: order.code }),
    ...(includeItems ? { items: mappedItems } : {}),
    ...(includeValidation ? {
      warnings: {
        hasPriceChanges,
        hasStockWarnings,
      },
    } : {}),
  };
};

const recordAudit = async ({ tenantId, actorName, actorRole, action, entityId, summary, metadata = {} }) => {
  try {
    await runWithTenantContext({ tenantId }, () => auditLogService.record({
      actorName,
      actorRole,
      action,
      module: 'mobile_order_handoff',
      entityType: 'mobile_order',
      entityId,
      summary,
      metadata,
      severity: 'info',
      source: 'mobile_order_handoff',
    }));
  } catch {
    // Audit must not break customer/POS flow.
  }
};

const enforceLookupRateLimit = (tenantId, code) => {
  const key = `${tenantId}:${code}`;
  const now = Date.now();
  const recent = (lookupHits.get(key) || []).filter((at) => now - at <= 60_000);
  recent.push(now);
  lookupHits.set(key, recent);
  if (recent.length > 20) {
    throw new AppError(429, 'Çok fazla mobil sipariş sorgusu yapıldı. Lütfen biraz sonra tekrar deneyin.', {
      errorCode: 'mobile_order_rate_limited',
    });
  }
};

export const mobileOrderService = {
  async getForCustomer(customerId, orderId) {
    const prisma = await getPrisma();
    const order = await prisma.mobileOrder.findFirst({
      where: { id: orderId, customerId },
      include: { items: true, customer: true },
    });
    if (!order) throw createNotFoundError('Mobil sipariş bulunamadı');
    return buildPublicOrder(order, { includeValidation: true });
  },

  async createFromCustomerCart(customerId, payload = {}) {
    const customer = await customerRepo.findById(customerId);
    if (!customer) throw createNotFoundError('Müşteri bulunamadı');
    const tenantId = resolveCustomerTenantId(customer);
    const storeId = await resolveStoreId(tenantId);
    const cartItems = normalizeCartItems(customer, payload);
    if (!cartItems.length) {
      throw new AppError(400, 'Kasaya aktarılacak geçerli sepet ürünü bulunamadı.', { errorCode: 'mobile_order_empty_cart' });
    }

    const productMap = await getCurrentProductRows(tenantId, cartItems.map((item) => item.productId));
    const orderItems = cartItems.map((item) => {
      const product = productMap.get(item.productId);
      if (!product) {
        throw new AppError(400, `${item.productName || item.productId} artık satışta değil.`, {
          errorCode: 'mobile_order_product_unavailable',
        });
      }
      if (product.currentStock <= 0) {
        throw new AppError(400, 'Bu ürün stokta bulunmamaktadır.', {
          errorCode: 'mobile_order_out_of_stock',
        });
      }
      if (item.quantity > product.currentStock) {
        throw new AppError(400, `Bu üründen en fazla ${product.currentStock} adet ekleyebilirsiniz.`, {
          errorCode: 'mobile_order_insufficient_stock',
        });
      }
      const quantity = item.quantity;
      const unitPrice = roundMoney(product.unitPrice || item.unitPrice);
      return {
        productId: item.productId,
        sku: product.sku || '',
        barcode: product.barcode || '',
        productNameSnapshot: product.name || item.productName,
        quantity,
        unitPriceSnapshot: unitPrice,
        totalPriceSnapshot: roundMoney(unitPrice * quantity),
      };
    });
    const itemPricing = Object.fromEntries(orderItems.map((item) => {
      const product = productMap.get(item.productId);
      return [item.productId, {
        regularPrice: roundMoney(product?.regularPrice || item.unitPriceSnapshot),
        discountedPrice: product?.discountedPrice ? roundMoney(product.discountedPrice) : null,
        hasActiveCampaign: product?.hasActiveCampaign === true,
        activeCampaignName: product?.activeCampaignName || '',
        campaignInfo: product?.campaignInfo || '',
      }];
    }));
    const totalSnapshot = roundMoney(orderItems.reduce((sum, item) => sum + item.totalPriceSnapshot, 0));
    const expiresAt = new Date(Date.now() + MOBILE_ORDER_TTL_MINUTES * 60 * 1000);
    const rawToken = createRawToken();
    const tokenHash = hashToken(rawToken);
    const displayOrderNo = await buildNextMobileDisplayOrderNo(tenantId);
    const prisma = await getPrisma();

    let code = createShortCode();
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const existing = await runWithTenantContext({ tenantId, storeId }, () => prisma.mobileOrder.findFirst({ where: { code } }));
      if (!existing) break;
      code = createShortCode();
    }

    // Capture lightweight location snapshot for each item at order creation time
    let locationSnapshots = {};
    try {
      const locationRows = await runWithTenantContext({ tenantId }, () => prisma.product.findMany({
        where: { id: { in: orderItems.map((item) => item.productId).filter(Boolean) } },
        select: {
          id: true,
          sectionId: true,
          shelfCode: true,
          shelfSide: true,
          shelfNo: true,
          shelfLevel: true,
          isVirtualLocation: true,
          depotLocationCode: true,
          section: { select: { name: true, number: true } },
        },
      }));
      locationSnapshots = Object.fromEntries(locationRows.map((row) => [row.id, {
        sectionId: row.sectionId || null,
        sectionName: row.section?.name || null,
        sectionNumber: row.section?.number ?? null,
        shelfCode: row.shelfCode || null,
        shelfSide: row.shelfSide || null,
        shelfNo: row.shelfNo ?? null,
        shelfLevel: row.shelfLevel ?? null,
        isVirtualLocation: row.isVirtualLocation === true,
        depotLocationCode: row.depotLocationCode || null,
        snapshotAt: new Date().toISOString(),
      }]));
    } catch {
      // Location snapshot is best-effort; must not block order creation
    }

    const order = await runWithTenantContext({ tenantId, storeId }, () => prisma.mobileOrder.create({
      data: {
        id: uuidv4(),
        tenantId,
        storeId,
        customerId,
        code,
        tokenHash,
        status: MOBILE_ORDER_STATUS.PENDING_CASHIER,
        subtotalSnapshot: totalSnapshot,
        totalSnapshot,
        itemCount: orderItems.reduce((sum, item) => sum + item.quantity, 0),
        expiresAt,
        payload: {
          source: 'customer_mobile',
          ttlMinutes: MOBILE_ORDER_TTL_MINUTES,
          displayOrderNo,
          orderNo: displayOrderNo,
          itemPricing,
          locationSnapshots,
        },
        items: { create: orderItems.map((item) => ({ ...item, tenantId })) },
      },
      include: { items: true, customer: true },
    }));

    await recordAudit({
      tenantId,
      actorName: customer.name || customer.email || customerId,
      actorRole: 'customer',
      action: 'Müşteri mobil sipariş oluşturdu',
      entityId: order.id,
      summary: 'Müşteri sepetini POS kasaya aktarmak için mobil sipariş kodu oluşturdu.',
      metadata: { code: order.code, itemCount: order.itemCount },
    });

    return buildPublicOrder(order);
  },

  async confirmCustomerHandoff(customerId, orderId) {
    const prisma = await getPrisma();
    const order = await prisma.mobileOrder.findFirst({
      where: { id: orderId, customerId },
      include: { items: true, customer: true },
    });
    if (!order) throw createNotFoundError('Mobil sipariş bulunamadı');
    if (order.expiresAt.getTime() <= Date.now() && ![MOBILE_ORDER_STATUS.PULLED_TO_POS, MOBILE_ORDER_STATUS.COMPLETED].includes(order.status)) {
      await prisma.mobileOrder.update({ where: { id: order.id }, data: { status: MOBILE_ORDER_STATUS.EXPIRED } });
      throw new AppError(410, 'Bu mobil sipariş kodunun süresi dolmuş.', { errorCode: 'mobile_order_expired' });
    }

    const nextStatus = order.status === MOBILE_ORDER_STATUS.COMPLETED
      ? MOBILE_ORDER_STATUS.COMPLETED
      : order.status === MOBILE_ORDER_STATUS.PULLED_TO_POS
        ? MOBILE_ORDER_STATUS.PULLED_TO_POS
        : MOBILE_ORDER_STATUS.CUSTOMER_CONFIRMED_HANDOFF;
    const updated = await prisma.mobileOrder.update({
      where: { id: order.id },
      data: { status: nextStatus },
      include: { items: true, customer: true },
    });

    const displayOrderNo = String(updated.payload?.displayOrderNo || updated.payload?.orderNo || '').trim()
      || await buildNextMobileDisplayOrderNo(updated.tenantId);
    const customerOrderId = String(updated.payload?.customerOrderId || `mobile-order-${updated.id}`);
    const customerOrder = buildCustomerOrderFromMobileOrder(updated, {
      customerOrderId,
      displayOrderNo,
      status: nextStatus,
    });

    const cleanupResult = await prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe('SELECT id FROM mobile_orders WHERE id = $1 FOR UPDATE', updated.id);
      const lockedOrder = await tx.mobileOrder.findUnique({ where: { id: updated.id } });
      const lockedPayload = lockedOrder?.payload || {};
      await tx.customerOrder.upsert({
        where: { id: customerOrder.id },
        create: {
          id: customerOrder.id,
          tenantId: updated.tenantId,
          customerId,
          totalAmount: customerOrder.totalAmount,
          items: customerOrder.items,
          status: customerOrder.status,
          payload: customerOrder,
          createdAt: new Date(customerOrder.createdAt),
          updatedAt: new Date(customerOrder.updatedAt),
        },
        update: {
          totalAmount: customerOrder.totalAmount,
          items: customerOrder.items,
          status: customerOrder.status,
          payload: customerOrder,
          updatedAt: new Date(customerOrder.updatedAt),
        },
      });
      const customerRow = await tx.customer.findUnique({ where: { id: customerId } });
      if (!customerRow) throw createNotFoundError('Müşteri bulunamadı');

      const customerPayload = customerRow.payload && typeof customerRow.payload === 'object'
        ? customerRow.payload
        : {};
      let activeCart = customerPayload.activeCart || null;
      if (lockedPayload.cartCleanupCompleted !== true) {
        const currentItems = Array.isArray(activeCart?.items) ? activeCart.items : [];
        const remainingItems = subtractCompletedCartItems(currentItems, updated.items);
        activeCart = remainingItems.length > 0 ? {
          ...(activeCart || {}),
          id: activeCart?.id || `cart-${customerId}`,
          items: remainingItems,
          status: 'active',
          updatedAt: new Date().toISOString(),
        } : null;
        await tx.customer.update({
          where: { id: customerId },
          data: {
            payload: {
              ...customerPayload,
              activeCart,
              updatedAt: new Date().toISOString(),
            },
            updatedAt: new Date(),
          },
        });
      }
      await tx.mobileOrder.update({
        where: { id: updated.id },
        data: {
          payload: {
            ...lockedPayload,
            customerOrderId: customerOrder.id,
            displayOrderNo,
            orderNo: displayOrderNo,
            historyCreated: true,
            cartCleanupPending: false,
            cartCleanupCompleted: true,
          },
        },
      });
      return { activeCart };
    });

    await recordAudit({
      tenantId: updated.tenantId,
      actorName: updated.customer?.name || customerId,
      actorRole: 'customer',
      action: 'Müşteri kodu kasiyere gösterdim dedi',
      entityId: updated.id,
      summary: 'Müşteri mobil sipariş kodu ekranını kapattı ve sipariş geçmişe taşındı.',
      metadata: { code: updated.code, status: nextStatus },
    });

    const finalized = await prisma.mobileOrder.findUnique({
      where: { id: updated.id },
      include: { items: true, customer: true },
    });
    return {
      ...(await buildPublicOrder(finalized)),
      customerOrder,
      activeCart: cleanupResult.activeCart || null,
      cartCleanupCompleted: true,
    };
  },

  async lookupForPos(input = {}, userContext = {}) {
    const tenantId = getActiveTenantId();
    const storeId = getActiveStoreId();
    const code = parseLookupCode(input.code || input.qr || input.token);
    if (!code) throw new AppError(400, 'Mobil sipariş kodu zorunludur.', { errorCode: 'mobile_order_code_required' });
    enforceLookupRateLimit(tenantId, code);

    const prisma = await getPrisma();
    const order = await prisma.mobileOrder.findFirst({
      where: { code, tenantId, OR: [{ storeId }, { storeId: null }] },
      include: { items: true, customer: true },
    });
    if (!order) throw createNotFoundError('Mobil sipariş bulunamadı');
    if (order.expiresAt.getTime() <= Date.now() && order.status !== MOBILE_ORDER_STATUS.COMPLETED) {
      await prisma.mobileOrder.update({ where: { id: order.id }, data: { status: MOBILE_ORDER_STATUS.EXPIRED } });
      throw new AppError(410, 'Bu mobil sipariş kodunun süresi dolmuş.', { errorCode: 'mobile_order_expired' });
    }
    if (order.status === MOBILE_ORDER_STATUS.COMPLETED) {
      throw new AppError(409, 'Bu mobil sipariş tamamlanmış.', { errorCode: 'mobile_order_completed' });
    }
    if (order.status === MOBILE_ORDER_STATUS.CANCELLED) {
      throw new AppError(409, 'Bu mobil sipariş iptal edilmiş.', { errorCode: 'mobile_order_cancelled' });
    }

    if (order.status === MOBILE_ORDER_STATUS.PULLED_TO_POS) {
      throw new AppError(409, 'Bu mobil sipariş daha önce POS sepetine aktarılmış.', { errorCode: 'mobile_order_already_pulled' });
    }

    await recordAudit({
      tenantId,
      actorName: userContext?.name || userContext?.username || 'Kasiyer',
      actorRole: userContext?.role || 'cashier',
      action: 'POS mobil siparişi getirdi',
      entityId: order.id,
      summary: 'Kasiyer mobil sipariş kodu ile sipariş önizlemesini açtı.',
      metadata: { code: order.code },
    });

    return buildPublicOrder(order, { includeValidation: true });
  },

  async pullToPos(orderId, userContext = {}) {
    const tenantId = getActiveTenantId();
    const storeId = getActiveStoreId();
    const prisma = await getPrisma();
    const order = await prisma.mobileOrder.findFirst({
      where: { id: orderId, tenantId, OR: [{ storeId }, { storeId: null }] },
      include: { items: true, customer: true },
    });
    if (!order) throw createNotFoundError('Mobil sipariş bulunamadı');
    if (order.expiresAt.getTime() <= Date.now()) {
      await prisma.mobileOrder.update({ where: { id: order.id }, data: { status: MOBILE_ORDER_STATUS.EXPIRED } });
      throw new AppError(410, 'Bu mobil sipariş kodunun süresi dolmuş.', { errorCode: 'mobile_order_expired' });
    }
    if (order.status === MOBILE_ORDER_STATUS.COMPLETED) {
      throw new AppError(409, 'Bu mobil sipariş tamamlanmış.', { errorCode: 'mobile_order_completed' });
    }

    if (order.status === MOBILE_ORDER_STATUS.CANCELLED) {
      throw new AppError(409, 'Bu mobil sipariş iptal edilmiş.', { errorCode: 'mobile_order_cancelled' });
    }
    if (order.status === MOBILE_ORDER_STATUS.PULLED_TO_POS) {
      throw new AppError(409, 'Bu mobil sipariş daha önce POS sepetine aktarılmış.', { errorCode: 'mobile_order_already_pulled' });
    }

    const publicOrder = await buildPublicOrder(order, { includeValidation: true });

    // Validate that no items are out of stock, unavailable or have insufficient stock
    const outOfStockItems = publicOrder.items.filter((item) => item.stockStatus === 'out_of_stock' || item.stockStatus === 'unavailable');
    if (outOfStockItems.length > 0) {
      const names = outOfStockItems.map((item) => item.name || item.productName || item.productId).join(', ');
      throw new AppError(400, `Siparişteki bazı ürünler stokta bulunmamaktadır: ${names}`, {
        errorCode: 'mobile_order_pull_out_of_stock',
      });
    }

    const insufficientItems = publicOrder.items.filter((item) => item.stockStatus === 'insufficient');
    if (insufficientItems.length > 0) {
      const names = insufficientItems.map((item) => `${item.name || item.productName || item.productId} (İstenen: ${item.quantity}, Stok: ${item.currentStock})`).join(', ');
      throw new AppError(400, `Siparişteki bazı ürünler için yetersiz stok: ${names}`, {
        errorCode: 'mobile_order_pull_insufficient_stock',
      });
    }

    const transferableItems = publicOrder.items
      .map((item) => ({
        productId: item.productId,
        id: item.productId,
        name: item.productName,
        sku: item.sku,
        barcode: item.barcode,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        salePrice: item.unitPrice,
        currentPrice: item.unitPrice,
        currentStock: item.currentStock,
        hasActiveCampaign: item.hasActiveCampaign,
        campaignInfo: item.campaignInfo,
      }))
      .filter((item) => item.quantity > 0);

    const updated = await prisma.mobileOrder.update({
      where: { id: order.id },
      data: { status: MOBILE_ORDER_STATUS.PULLED_TO_POS, pulledAt: new Date() },
      include: { items: true, customer: true },
    });

    await recordAudit({
      tenantId,
      actorName: userContext?.name || userContext?.username || 'Kasiyer',
      actorRole: userContext?.role || 'cashier',
      action: 'POS mobil siparişten satırları sepete aktardı',
      entityId: updated.id,
      summary: 'Mobil sipariş ürünleri POS sepetine aktarılabilir veri olarak döndü.',
      metadata: { code: updated.code, transferredItemCount: transferableItems.length },
    });

    return {
      ...(await buildPublicOrder(updated, { includeValidation: true })),
      posItems: transferableItems,
    };
  },

  async completeFromPos(orderId, sale = {}, userContext = {}) {
    if (!orderId) return null;
    const prisma = await getPrisma();
    const storeId = getActiveStoreId();
    const order = await prisma.mobileOrder.findFirst({
      where: { id: orderId, tenantId: getActiveTenantId(), OR: [{ storeId }, { storeId: null }] },
      include: { customer: true },
    });
    if (!order) return null;
    if (order.status === MOBILE_ORDER_STATUS.COMPLETED && order.payload?.cartCleanupCompleted === true) {
      return {
        ...(await buildPublicOrder(order)),
        cartCleanupPending: false,
      };
    }

    const updated = await prisma.mobileOrder.update({
      where: { id: order.id },
      data: {
        status: MOBILE_ORDER_STATUS.COMPLETED,
        completedAt: new Date(),
        payload: {
          ...(order.payload || {}),
          saleId: sale.id || null,
          saleReferenceNo: sale.referenceNo || null,
          cartCleanupPending: true,
          cartCleanupCompleted: false,
        },
      },
      include: { items: true, customer: true },
    });

    let cartCleanupPending = false;
    try {
      await retryCartCleanup(updated.customerId, updated.items);
      await prisma.mobileOrder.update({
        where: { id: updated.id },
        data: {
          payload: {
            ...(updated.payload || {}),
            cartCleanupPending: false,
            cartCleanupCompleted: true,
          },
        },
      });
    } catch (error) {
      cartCleanupPending = true;
      console.error('[MobileOrder] Completed order cart cleanup failed after retries:', {
        orderId: updated.id,
        customerId: updated.customerId,
        message: error?.message || String(error),
      });
    }

    const customerOrderId = order.payload?.customerOrderId || null;
    if (customerOrderId) {
      await customerOrderRepo.updateById?.(customerOrderId, (current) => ({
        ...current,
        status: 'tamamlandi',
        updatedAt: new Date().toISOString(),
        payload: {
          ...(current?.payload || {}),
          saleId: sale.id || null,
          saleReferenceNo: sale.referenceNo || null,
        },
      }));
    }

    await recordAudit({
      tenantId: updated.tenantId,
      actorName: userContext?.name || userContext?.username || 'Kasiyer',
      actorRole: userContext?.role || 'cashier',
      action: 'POS mobil siparişten satış tamamladı',
      entityId: updated.id,
      summary: 'Mobil sipariş POS satış kaydı ile tamamlandı.',
      metadata: { code: updated.code, saleReferenceNo: sale.referenceNo || null },
    });

    return {
      ...(await buildPublicOrder(updated)),
      cartCleanupPending,
    };
  },
};
