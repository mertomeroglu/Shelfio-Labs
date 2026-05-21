import { v4 as uuidv4 } from 'uuid';
import { AppError } from '../utils/appError.js';
import { customerRepo } from '../repositories/customerRepository.js';
import { customerOrderRepo } from '../repositories/customerOrderRepository.js';
import { notificationRepo } from '../repositories/notificationRepository.js';
import { settingsRepo } from '../repositories/settingsRepository.js';

const normalize = (v) => String(v || '').trim();
const normalizePhone = (v) => normalize(v).replace(/\D/g, '');
const CUSTOMER_NO_LENGTH = 8;
const CUSTOMER_NOTIFICATION_TYPES = new Set(['bilgilendirme', 'kampanya', 'uyari']);
const MOJIBAKE_PATTERN = /\u00c3.|\u00c2.|\u00e2.|\u00c4.|\u00c5.|\u00ef\u00bf\u00bd/;

const tryDecodeMojibake = (value) => {
  if (typeof value !== 'string') return value;
  if (!MOJIBAKE_PATTERN.test(value)) return value.normalize('NFC');
  try {
    const decoded = Buffer.from(value, 'latin1').toString('utf8');
    return (decoded || value).normalize('NFC');
  } catch {
    return value.normalize('NFC');
  }
};

const normalizeUtf8Deep = (value) => {
  if (typeof value === 'string') return tryDecodeMojibake(value);
  if (Array.isArray(value)) return value.map((item) => normalizeUtf8Deep(item));
  if (value && typeof value === 'object') {
    const normalized = {};
    Object.entries(value).forEach(([key, entry]) => {
      normalized[key] = normalizeUtf8Deep(entry);
    });
    return normalized;
  }
  return value;
};

const normalizeCodeValue = (value) => String(value || '').trim().toUpperCase();

const resolveGiftCardUsageState = (card = {}) => {
  const usageLimitSource = Number(card?.usageLimit ?? card?.maxUsage ?? 1);
  const usageLimit = Number.isFinite(usageLimitSource) && usageLimitSource >= 1 ? Math.floor(usageLimitSource) : 1;
  const usedCountSource = Number(card?.usedCount ?? 0);
  const usedCount = Number.isFinite(usedCountSource) && usedCountSource >= 0 ? Math.floor(usedCountSource) : 0;
  const remainingUsageSource = Number(card?.remainingUsage);
  const remainingUsage = Number.isFinite(remainingUsageSource)
    ? Math.max(0, Math.min(usageLimit, Math.floor(remainingUsageSource)))
    : Math.max(0, usageLimit - usedCount);

  return {
    usageLimit,
    maxUsage: usageLimit,
    usedCount: Math.min(usedCount, usageLimit),
    remainingUsage,
  };
};

const isGiftCardExpired = (card) => {
  const expiresAt = String(card?.expiresAt || card?.endDate || '').trim();
  if (!expiresAt) return false;
  return new Date(`${expiresAt}T23:59:59`).getTime() < Date.now();
};

const isGiftCardAssignable = (card) => {
  const status = String(card?.status || '').toLocaleLowerCase('tr-TR');
  const { remainingUsage } = resolveGiftCardUsageState(card);
  return card?.isActive !== false
    && status !== 'used'
    && status !== 'pasif'
    && remainingUsage > 0
    && !isGiftCardExpired(card);
};

const mapGiftCardCatalogRow = (card = {}) => ({
  id: card?.id || uuidv4(),
  code: normalizeCodeValue(card?.code),
  name: String(card?.name || '').trim() || '-',
  value: Number(card?.value || 0),
  valueType: String(card?.valueType || 'fixed'),
  allowedCategoryIds: Array.isArray(card?.allowedCategoryIds) ? card.allowedCategoryIds : [],
  status: String(card?.status || 'active'),
  expiresAt: card?.expiresAt || card?.endDate || null,
  isActive: card?.isActive !== false,
  assignedCustomerId: card?.assignedCustomerId || null,
  assignedCustomerName: String(card?.assignedCustomerName || '').trim() || null,
  ...resolveGiftCardUsageState(card),
});

const updateGiftCardAssignmentInSettings = async ({ code, customerId, customerName }) => {
  const settings = await settingsRepo.getSettings();
  const nextGiftCards = (Array.isArray(settings?.customerRelations?.giftCards) ? settings.customerRelations.giftCards : []).map((card) => {
    if (normalizeCodeValue(card?.code) !== code) return card;
    return {
      ...card,
      status: 'assigned',
      isActive: true,
      assignedCustomerId: customerId,
      assignedCustomerName: customerName || null,
      assignedAt: new Date().toISOString(),
    };
  });

  await settingsRepo.updateSettings({
    ...settings,
    customerRelations: {
      ...(settings?.customerRelations || {}),
      giftCards: nextGiftCards,
    },
  });
};

const normalizeFavoriteRows = (customer = {}) => {
  const rows = Array.isArray(customer.favorites) ? customer.favorites : [];
  return rows
    .map((item) => {
      const productId = String(item?.productId || item?.id || '').trim();
      if (!productId) return null;
      return {
        productId,
        id: productId,
        productName: item?.productName || item?.name || '',
        categoryId: item?.categoryId || null,
        addedAt: item?.addedAt || null,
        source: item?.source || 'backend',
      };
    })
    .filter(Boolean);
};

const normalizeShoppingRows = (customer = {}) => {
  const direct = Array.isArray(customer.shoppingList) ? customer.shoppingList : [];
  const lists = Array.isArray(customer.shoppingLists) ? customer.shoppingLists : [];
  const listItems = lists
    .filter((list) => String(list?.status || 'active').toLowerCase() !== 'archived')
    .flatMap((list) => (Array.isArray(list?.items) ? list.items : []));
  const rows = direct.length ? direct : listItems;
  const byProduct = new Map();
  for (const item of rows) {
    const productId = String(item?.productId || item?.id || '').trim();
    if (!productId) continue;
    const existing = byProduct.get(productId);
    const next = {
      id: productId,
      productId,
      productName: item?.productName || item?.name || existing?.productName || '',
      quantity: Number(item?.quantity || existing?.quantity || 1),
      unit: item?.unit || existing?.unit || 'adet',
      shelfCode: item?.shelfCode || item?.defaultShelfLocationCode || existing?.shelfCode || '-',
      checked: item?.checked === true,
    };
    byProduct.set(productId, existing ? { ...next, quantity: Number(existing.quantity || 0) + Number(next.quantity || 0) } : next);
  }
  return Array.from(byProduct.values());
};

const normalizeCartItems = (customer = {}) => {
  const cart = customer.activeCart || customer.cart || customer.currentCart || null;
  const rows = Array.isArray(cart?.items) ? cart.items : [];
  return rows
    .map((item) => {
      const productId = String(item?.productId || item?.id || '').trim();
      if (!productId) return null;
      return {
        id: productId,
        productId,
        productName: item?.productName || item?.name || '',
        quantity: Number(item?.quantity || 1),
        unit: item?.unit || 'adet',
        unitPrice: Number(item?.unitPrice || item?.price || 0),
      };
    })
    .filter(Boolean);
};

const cartObjectFromItems = (items = []) => items.reduce((acc, item) => {
  acc[String(item.productId)] = Number(item.quantity || 0);
  return acc;
}, {});

const mapCustomer = (x) => {
  const favorites = normalizeFavoriteRows(x);
  const shoppingList = normalizeShoppingRows(x);
  const cartItems = normalizeCartItems(x);
  return {
    id: x.id,
    customerNo: String(x.customerNo || ''),
    name: x.name,
    phone: x.phone,
    email: x.email,
    totalOrders: Number(x.totalOrders || 0),
    totalSpent: Number(x.totalSpent || 0),
    isActive: x.isActive !== false,
    createdAt: x.createdAt,
    updatedAt: x.updatedAt,
    discounts: Array.isArray(x.discounts) ? x.discounts : [],
    giftCards: Array.isArray(x.giftCards) ? x.giftCards : [],
    favorites,
    favoriteIds: favorites.map((item) => item.productId),
    shoppingList,
    shoppingLists: Array.isArray(x.shoppingLists) ? x.shoppingLists : [],
    activeCart: x.activeCart || x.cart || x.currentCart || null,
    cartItems,
    cart: cartObjectFromItems(cartItems),
  };
};

const mapOrder = (x) => ({
  id: x.id,
  orderNo: x.orderNo || x.referenceNo || x.id,
  customerId: x.customerId,
  createdAt: x.createdAt,
  totalAmount: Number(x.totalAmount || 0),
  items: Array.isArray(x.items) ? x.items : [],
  status: x.status || 'tamamlandi',
});

const normalizePositiveNumber = (value, fallback = 0) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
};

const normalizeCartItemRow = (item = {}) => {
  const productId = String(item?.productId || item?.id || '').trim();
  if (!productId) return null;

  const quantity = Math.max(0, Math.floor(normalizePositiveNumber(item?.quantity, 0)));
  if (quantity <= 0) return null;

  return {
    id: productId,
    productId,
    productName: String(item?.productName || item?.name || '').trim() || productId,
    quantity,
    unit: String(item?.unit || 'adet').trim() || 'adet',
    unitPrice: Number(item?.unitPrice ?? item?.price ?? 0) || 0,
  };
};

const normalizeCartPayload = (payload = {}) => {
  const directItems = Array.isArray(payload?.items) ? payload.items : [];
  const objectItems = payload?.cart && typeof payload.cart === 'object' && !Array.isArray(payload.cart)
    ? Object.entries(payload.cart).map(([productId, quantity]) => ({ productId, quantity }))
    : [];
  const rows = [...directItems, ...objectItems]
    .map((item) => normalizeCartItemRow(item))
    .filter(Boolean);

  const byProductId = new Map();
  rows.forEach((row) => {
    byProductId.set(row.productId, row);
  });

  const items = Array.from(byProductId.values());
  return {
    items,
    cart: cartObjectFromItems(items),
  };
};

const buildActiveCartRecord = (customer = {}, items = []) => {
  if (!items.length) return null;
  return {
    id: customer?.activeCart?.id || `cart-${customer?.id || uuidv4()}`,
    items,
    status: 'active',
    updatedAt: new Date().toISOString(),
  };
};

const buildNextCustomerOrderNo = async () => {
  const allOrders = await customerOrderRepo.getAll();
  const todayKey = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const todayCount = allOrders.filter((row) => String(row?.createdAt || '').startsWith(`${todayKey.slice(0, 4)}-${todayKey.slice(4, 6)}-${todayKey.slice(6, 8)}`)).length;
  return `MOB-${todayKey}-${String(todayCount + 1).padStart(4, '0')}`;
};

const padCustomerNo = (value) => String(value || 0).replace(/\D/g, '').padStart(CUSTOMER_NO_LENGTH, '0').slice(-CUSTOMER_NO_LENGTH);

const resolveNextCustomerNo = (all = []) => {
  const used = new Set(
    all
      .map((item) => String(item?.customerNo || '').trim())
      .filter(Boolean)
  );

  let maxSeq = 0;
  for (const value of used) {
    const numeric = Number.parseInt(value, 10);
    if (Number.isFinite(numeric) && numeric > maxSeq) maxSeq = numeric;
  }

  let candidate = maxSeq + 1;
  let customerNo = padCustomerNo(candidate);
  while (used.has(customerNo)) {
    candidate += 1;
    customerNo = padCustomerNo(candidate);
  }
  return customerNo;
};

const ensureCustomerNumbers = async () => {
  const rows = await customerRepo.readData();
  const seen = new Set();
  let maxSeq = rows.reduce((max, row) => {
    const numeric = Number.parseInt(String(row?.customerNo || '').trim(), 10);
    return Number.isFinite(numeric) ? Math.max(max, numeric) : max;
  }, 0);

  const nextCustomerNo = () => {
    maxSeq += 1;
    let candidate = padCustomerNo(maxSeq);
    while (seen.has(candidate)) {
      maxSeq += 1;
      candidate = padCustomerNo(maxSeq);
    }
    return candidate;
  };

  let changed = false;

  const nextRows = rows.map((row) => {
    const normalizedRow = normalizeUtf8Deep(row);
    if (JSON.stringify(normalizedRow) !== JSON.stringify(row)) {
      changed = true;
    }

    const sourceRow = normalizedRow;
    const currentNo = String(sourceRow?.customerNo || '').trim();
    if (!currentNo || seen.has(currentNo)) {
      const generatedNo = nextCustomerNo();
      seen.add(generatedNo);
      changed = true;
      return { ...sourceRow, customerNo: generatedNo, updatedAt: new Date().toISOString() };
    }
    seen.add(currentNo);
    return sourceRow;
  });

  if (changed) {
    await customerRepo.writeData(nextRows);
  }

  return changed ? nextRows : rows;
};

const getGiftCardCatalogState = async ({ customerId = '' } = {}) => {
  const allCustomers = await ensureCustomerNumbers();
  const settings = await settingsRepo.getSettings();
  const campaignGiftCards = Array.isArray(settings?.customerRelations?.giftCards) ? settings.customerRelations.giftCards : [];
  const campaignCardByCode = new Map(
    campaignGiftCards
      .map((card) => [normalizeCodeValue(card?.code), mapGiftCardCatalogRow(card)])
      .filter(([code]) => Boolean(code))
  );

  const availableGiftCards = Array.from(campaignCardByCode.values())
    .filter((card) => isGiftCardAssignable(card));

  const selectedCustomer = customerId ?
    allCustomers.find((entry) => String(entry.id) === String(customerId))
    : null;

  const assignedGiftCards = selectedCustomer
    ? (Array.isArray(selectedCustomer.giftCards) ? selectedCustomer.giftCards : [])
      .map((card) => {
        const code = normalizeCodeValue(card?.code);
        const source = campaignCardByCode.get(code);
        if (!source) {
          return { ...card, code, isValid: false };
        }

        const sourceStatus = String(source.status || '').toLocaleLowerCase('tr-TR');
        const isUsableSource = source.isActive !== false
          && sourceStatus !== 'used'
          && sourceStatus !== 'pasif'
          && !isGiftCardExpired(source);

        if (!isUsableSource) {
          return { ...card, code, isValid: false };
        }

        return {
          ...card,
          code,
          sourceGiftCardId: source.id || card?.sourceGiftCardId || null,
          sourceName: source.name || String(card?.sourceName || '').trim() || null,
          value: Number(source.value ?? card?.value ?? 0),
          valueType: String(source.valueType || card?.valueType || 'fixed'),
          status: source.status || card?.status || 'assigned',
          expiresAt: source.expiresAt || card?.expiresAt || null,
          assignedCustomerId: selectedCustomer.id,
          assignedCustomerName: selectedCustomer.name || null,
          ...resolveGiftCardUsageState(source),
          isValid: true,
        };
      })
      .filter((card) => card?.isValid === true)
    : [];

  return {
    allCustomers,
    availableGiftCards,
    assignedGiftCards,
    campaignCardByCode,
  };
};

export const customerService = {
  async list() {
    return (await ensureCustomerNumbers()).map(mapCustomer);
  },

  async create(payload) {
    const name = normalize(payload.name);
    const phone = normalizePhone(payload.phone);
    const email = normalize(payload.email).toLowerCase();
    if (!name || !phone || !email) throw new AppError(400, 'Ad soyad, telefon ve email zorunludur');

    const all = await ensureCustomerNumbers();
    if (all.some((x) => normalizePhone(x.phone) === phone || String(x.email || '').toLowerCase() === email)) {
      throw new AppError(409, 'Telefon veya email zaten kayitli');
    }

    const now = new Date().toISOString();
    const customerNo = resolveNextCustomerNo(all);
    if (all.some((x) => String(x.customerNo || '') === customerNo)) throw new AppError(409, 'Musteri no cakismasi olustu');

    const row = {
      id: uuidv4(),
      customerNo,
      name,
      phone,
      email,
      passwordHash: payload.passwordHash || '',
      totalOrders: 0,
      totalSpent: 0,
      isActive: payload.isActive !== false,
      createdAt: now,
      updatedAt: now,
      discounts: [],
      giftCards: [],
    };

    await customerRepo.create(row);
    return mapCustomer(row);
  },

  async detail(id) {
    const customer = await customerRepo.findById(id);
    if (!customer) throw new AppError(404, 'Musteri bulunamadi');

    const { availableGiftCards, assignedGiftCards } = await getGiftCardCatalogState({ customerId: id });
    const orders = (await customerOrderRepo.getAll())
      .filter((x) => x.customerId === id)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const totalSpent = orders.reduce((sum, row) => sum + Number(row.totalAmount || 0), 0);
    const mappedCustomer = { ...mapCustomer(customer), giftCards: assignedGiftCards };
    const mappedOrders = orders.map(mapOrder);

    return {
      customer: mappedCustomer,
      availableGiftCards,
      orders: mappedOrders,
      orderHistory: mappedOrders,
      lastOrders: mappedOrders.slice(0, 5),
      favorites: mappedCustomer.favorites,
      favoriteIds: mappedCustomer.favoriteIds,
      shoppingList: mappedCustomer.shoppingList,
      shoppingLists: mappedCustomer.shoppingLists,
      activeCart: mappedCustomer.activeCart,
      cartItems: mappedCustomer.cartItems,
      cart: mappedCustomer.cart,
      summary: {
        totalOrders: orders.length,
        totalSpent,
        averageOrderAmount: orders.length ? totalSpent / orders.length : 0,
        lastOrderAt: orders[0]?.createdAt || null,
      },
    };
  },

  async listAvailableGiftCards() {
    const { availableGiftCards } = await getGiftCardCatalogState();
    return availableGiftCards;
  },

  async portalDashboard(id) {
    const customer = await customerRepo.findById(id);
    if (!customer) throw new AppError(404, 'Musteri bulunamadi');

    const orders = (await customerOrderRepo.getAll())
      .filter((x) => x.customerId === id)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const totalSpent = orders.reduce((sum, row) => sum + Number(row.totalAmount || 0), 0);
    const mappedCustomer = mapCustomer(customer);
    const recentOrders = orders.slice(0, 10).map(mapOrder);

    return {
      customer: mappedCustomer,
      orders: recentOrders,
      orderHistory: recentOrders,
      lastOrders: recentOrders.slice(0, 5),
      favorites: mappedCustomer.favorites,
      favoriteIds: mappedCustomer.favoriteIds,
      shoppingList: mappedCustomer.shoppingList,
      shoppingLists: mappedCustomer.shoppingLists,
      activeCart: mappedCustomer.activeCart,
      cartItems: mappedCustomer.cartItems,
      cart: mappedCustomer.cart,
      summary: {
        totalOrders: orders.length,
        totalSpent,
        averageOrderAmount: orders.length ? totalSpent / orders.length : 0,
        lastOrderAt: orders[0]?.createdAt || null,
      },
    };
  },

  async listOrders(id, query = {}) {
    const customer = await customerRepo.findById(id);
    if (!customer) throw new AppError(404, 'Musteri bulunamadi');

    const safeLimit = Math.max(0, Number(query?.limit) || 0);
    const orders = (await customerOrderRepo.getAll())
      .filter((row) => String(row?.customerId || '') === String(id))
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      .map(mapOrder);

    return safeLimit > 0 ? orders.slice(0, safeLimit) : orders;
  },

  async getCart(id) {
    const customer = await customerRepo.findById(id);
    if (!customer) throw new AppError(404, 'Musteri bulunamadi');

    const mappedCustomer = mapCustomer(customer);
    return {
      customerId: mappedCustomer.id,
      activeCart: mappedCustomer.activeCart,
      cartItems: mappedCustomer.cartItems,
      cart: mappedCustomer.cart,
      updatedAt: mappedCustomer.activeCart?.updatedAt || mappedCustomer.updatedAt || null,
    };
  },

  async updateCart(id, payload = {}) {
    const customer = await customerRepo.findById(id);
    if (!customer) throw new AppError(404, 'Musteri bulunamadi');

    const normalizedCart = normalizeCartPayload(payload);
    const nextActiveCart = buildActiveCartRecord(customer, normalizedCart.items);
    const nextUpdatedAt = new Date().toISOString();

    const row = await customerRepo.updateById(id, (current) => ({
      ...current,
      activeCart: nextActiveCart,
      updatedAt: nextUpdatedAt,
    }));
    if (!row) throw new AppError(404, 'Musteri bulunamadi');

    const mappedCustomer = mapCustomer(row);
    return {
      customerId: mappedCustomer.id,
      activeCart: mappedCustomer.activeCart,
      cartItems: mappedCustomer.cartItems,
      cart: mappedCustomer.cart,
      updatedAt: mappedCustomer.activeCart?.updatedAt || mappedCustomer.updatedAt || nextUpdatedAt,
    };
  },

  async placeOrder(id, payload = {}) {
    const customer = await customerRepo.findById(id);
    if (!customer) throw new AppError(404, 'Musteri bulunamadi');

    const currentCartItems = normalizeCartItems(customer);
    const selectedIds = new Set(
      (Array.isArray(payload?.selectedProductIds) ? payload.selectedProductIds : [])
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    );

    const checkoutItems = (selectedIds.size
      ? currentCartItems.filter((item) => selectedIds.has(String(item.productId || item.id || '')))
      : currentCartItems)
      .map((item) => normalizeCartItemRow(item))
      .filter(Boolean);

    if (!checkoutItems.length) {
      throw new AppError(400, 'SipariÃ…Å¸e aktarÃ„Â±lacak geÃƒÂ§erli sepet ÃƒÂ¼rÃƒÂ¼nÃƒÂ¼ bulunamadÃ„Â±');
    }

    const totalAmount = checkoutItems.reduce((sum, item) => sum + (Number(item.unitPrice || 0) * Number(item.quantity || 0)), 0);
    const createdAt = new Date().toISOString();
    const orderNo = await buildNextCustomerOrderNo();
    const order = {
      id: uuidv4(),
      orderNo,
      customerId: id,
      createdAt,
      updatedAt: createdAt,
      totalAmount: Number(totalAmount.toFixed(2)),
      items: checkoutItems.map((item) => ({
        productId: item.productId,
        productName: item.productName,
        quantity: item.quantity,
        unit: item.unit,
        unitPrice: Number(item.unitPrice || 0),
      })),
      status: 'tamamlandi',
      source: 'mobile_customer_portal',
    };

    await customerOrderRepo.create(order);

    const remainingCartItems = selectedIds.size
      ? currentCartItems.filter((item) => !selectedIds.has(String(item.productId || item.id || '')))
      : [];
    const nextActiveCart = buildActiveCartRecord(customer, remainingCartItems);

    const updatedCustomer = await customerRepo.updateById(id, (current) => ({
      ...current,
      totalOrders: Number(current?.totalOrders || 0) + 1,
      totalSpent: Number((Number(current?.totalSpent || 0) + Number(order.totalAmount || 0)).toFixed(2)),
      activeCart: nextActiveCart,
      updatedAt: createdAt,
    }));
    if (!updatedCustomer) throw new AppError(404, 'Musteri bulunamadi');

    return {
      order: mapOrder(order),
      cart: {
        customerId: id,
        activeCart: nextActiveCart,
        cartItems: normalizeCartItems({ activeCart: nextActiveCart }),
        cart: cartObjectFromItems(normalizeCartItems({ activeCart: nextActiveCart })),
        updatedAt: createdAt,
      },
    };
  },

  async updateStatus(id, isActive) {
    const row = await customerRepo.updateById(id, (x) => ({ ...x, isActive: Boolean(isActive), updatedAt: new Date().toISOString() }));
    if (!row) throw new AppError(404, 'Musteri bulunamadi');
    return mapCustomer(row);
  },

  async assignGiftCard(id, payload) {
    const code = normalizeCodeValue(payload?.code);
    if (!code) throw new AppError(400, 'Hediye kartÄ± kodu zorunludur');

    const customer = await customerRepo.findById(id);
    if (!customer) throw new AppError(404, 'Musteri bulunamadi');

    const { campaignCardByCode } = await getGiftCardCatalogState();
    const sourceCard = campaignCardByCode.get(code);
    if (!sourceCard) throw new AppError(404, 'Girilen hediye kartÄ± kodu bulunamadÄ± veya aktif deÄŸil');
    if (!isGiftCardAssignable(sourceCard)) throw new AppError(409, 'Bu hediye kartÄ± atanabilir durumda deÄŸil');

    const alreadyAssigned = false;
    if (alreadyAssigned) throw new AppError(409, 'Bu hediye kartÄ± baÅŸka bir mÃ¼ÅŸteriye zaten atanmÄ±ÅŸ');

    const row = await customerRepo.updateById(id, (x) => {
      const existingCards = Array.isArray(x.giftCards) ? x.giftCards : [];
      if (existingCards.some((card) => normalizeCodeValue(card?.code) === code)) {
        throw new AppError(409, 'Bu hediye kartÄ± bu mÃ¼ÅŸteriye zaten atanmÄ±ÅŸ');
      }

      return {
        ...x,
        giftCards: [
          ...existingCards,
          {
            id: uuidv4(),
            code,
            sourceGiftCardId: sourceCard.id || null,
            sourceName: String(sourceCard.name || '').trim() || null,
            value: Number(sourceCard.value || 0),
            valueType: String(sourceCard.valueType || 'fixed'),
            usageLimit: Number(sourceCard.usageLimit ?? sourceCard.maxUsage ?? 1) || 1,
            maxUsage: Number(sourceCard.usageLimit ?? sourceCard.maxUsage ?? 1) || 1,
            usedCount: Number(sourceCard.usedCount || 0) || 0,
            remainingUsage: Number(sourceCard.remainingUsage ?? sourceCard.usageLimit ?? sourceCard.maxUsage ?? 1) || 1,
            allowedCategoryIds: Array.isArray(sourceCard.allowedCategoryIds) ? sourceCard.allowedCategoryIds : [],
            status: sourceCard.status || 'active',
            isActive: true,
            createdAt: new Date().toISOString(),
          },
        ],
        updatedAt: new Date().toISOString(),
      };
    });
    if (!row) throw new AppError(404, 'Musteri bulunamadi');

    await updateGiftCardAssignmentInSettings({ code, customerId: row.id, customerName: row.name });
    return mapCustomer(row);
  },

  async assignGiftCardBulk(payload = {}) {
    const code = normalizeCodeValue(payload?.code);
    const customerIds = Array.from(new Set(
      Array.isArray(payload.customerIds) ? payload.customerIds.map((id) => String(id || '').trim()).filter(Boolean) : []
    ));
    if (!code) throw new AppError(400, 'Hediye kartÄ± kodu zorunludur');
    if (!customerIds.length) throw new AppError(400, 'En az bir mÃ¼ÅŸteri seÃ§melisiniz');

    let assignedCount = 0;
    let skippedCount = 0;
    const errors = [];

    for (const customerId of customerIds) {
      try {
        await this.assignGiftCard(customerId, { code });
        assignedCount += 1;
      } catch (error) {
        skippedCount += 1;
        errors.push({ customerId, message: error.message });
      }
    }

    return { assignedCount, skippedCount, errors };
  },

  async assignDiscount(id, payload) {
    const type = payload.type === 'fixed' ? 'fixed' : 'percent';
    const value = Number(payload.value || 0);
    if (value <= 0) throw new AppError(400, 'Gecerli indirim girin');

    const row = await customerRepo.updateById(id, (x) => ({
      ...x,
      discounts: [
        ...(Array.isArray(x.discounts) ? x.discounts : []),
        {
          id: uuidv4(),
          type,
          value,
          title: normalize(payload.title) || 'Musteri indirimi',
          createdAt: new Date().toISOString(),
          isActive: true,
        },
      ],
      updatedAt: new Date().toISOString(),
    }));
    if (!row) throw new AppError(404, 'Musteri bulunamadi');
    return mapCustomer(row);
  },

  async sendNotification(payload = {}) {
    const title = normalize(payload.title);
    const message = normalize(payload.message);
    const type = normalize(payload.type).toLocaleLowerCase('tr-TR');
    const mode = normalize(payload.mode).toLocaleLowerCase('tr-TR') || 'single';
    const customerIds = Array.isArray(payload.customerIds) ? payload.customerIds.map((id) => String(id || '').trim()).filter(Boolean) : [];

    if (!title || !message) throw new AppError(400, 'Baslik ve mesaj zorunludur');
    if (!CUSTOMER_NOTIFICATION_TYPES.has(type)) throw new AppError(400, 'Gecersiz bildirim tipi');

    const allCustomers = await ensureCustomerNumbers();
    const activeCustomers = allCustomers.filter((row) => row?.isActive !== false);

    let targets = [];
    if (mode === 'single') {
      const singleId = customerIds[0] || String(payload.customerId || '').trim();
      if (!singleId) throw new AppError(400, 'Tekli gonderim icin musteri secin');
      targets = activeCustomers.filter((row) => row.id === singleId);
    } else if (mode === 'selected') {
      if (!customerIds.length) throw new AppError(400, 'Toplu gonderim icin musteri secin');
      const idSet = new Set(customerIds);
      targets = activeCustomers.filter((row) => idSet.has(row.id));
    } else if (mode === 'all') {
      targets = activeCustomers;
    } else {
      throw new AppError(400, 'Gecersiz gonderim modu');
    }

    if (!targets.length) throw new AppError(404, 'Bildirim gonderilecek aktif musteri bulunamadi');

    const createdAt = new Date().toISOString();
    const actionUrl = '/musteri';
    const typeMap = {
      bilgilendirme: 'customer_info',
      kampanya: 'customer_campaign',
      uyari: 'customer_alert',
    };

    const records = targets.map((customer) => ({
      id: uuidv4(),
      userId: customer.id,
      type: typeMap[type],
      title,
      message,
      severity: type === 'uyari' ? 'high' : type === 'kampanya' ? 'medium' : 'low',
      isRead: false,
      createdAt,
      relatedTaskId: null,
      dedupeKey: null,
      actionUrl,
      actionType: 'customer',
      audience: { scope: 'customer', type, customerId: customer.id, customerNo: customer.customerNo },
      delivery: { channel: 'mobile-customer-panel' },
    }));

    const allNotifications = await notificationRepo.getAll();
    await notificationRepo.writeData([...allNotifications, ...records]);

    return {
      success: true,
      targetMode: mode,
      sentCount: records.length,
      customerIds: targets.map((row) => row.id),
    };
  },

  async listCustomerNotifications(customerId, limit = 40) {
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 40));
    const all = await notificationRepo.findByUserId(customerId);
    return all
      .filter((row) => row?.audience?.scope === 'customer' || String(row?.actionType || '').toLowerCase() === 'customer')
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      .slice(0, safeLimit);
  },

  async markCustomerNotificationsAsRead(customerId) {
    const allNotifications = await notificationRepo.getAll();
    let updatedCount = 0;
    const nextNotifications = allNotifications.map((row) => {
      const isCustomerNotification = row?.audience?.scope === 'customer'
        || String(row?.actionType || '').toLowerCase() === 'customer';
      if (String(row?.userId || '') !== String(customerId) || !isCustomerNotification || row?.isRead) {
        return row;
      }
      updatedCount += 1;
      return { ...row, isRead: true };
    });
    if (updatedCount > 0) await notificationRepo.writeData(nextNotifications);
    return { updatedCount };
  },
};
