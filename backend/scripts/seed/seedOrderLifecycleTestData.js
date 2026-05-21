import 'dotenv/config';
import { getPrisma, disconnectPrisma } from '../../src/providers/postgresProvider.js';

const ACTOR_ID = 'u-admin-1';
const SOURCE = 'lifecycle_test';

const STATUS_DEFINITIONS = [
  { status: 'submitted_for_approval', label: 'Onaya Gonderildi' },
  { status: 'approved', label: 'Onaylandi' },
  { status: 'supplier_notified', label: 'Tedarikciye Iletildi' },
  { status: 'preparing', label: 'Hazirlaniyor' },
  { status: 'ready_to_ship', label: 'Sevke Hazir' },
  { status: 'in_transit', label: 'Yola Cikti' },
  { status: 'delivered', label: 'Depoya Ulasti' },
  { status: 'goods_receipt_pending', label: 'Mal Kabul Bekliyor' },
  { status: 'goods_receipt_completed', label: 'Mal Kabul Yapildi' },
  { status: 'stock_entry_pending', label: 'Stok Girisi Bekleniyor' },
  { status: 'completed', label: 'Tamamlandi' },
  { status: 'archived', label: 'Arsivlendi' },
  { status: 'cancelled', label: 'Iptal Edildi' },
];

const FULL_FLOW = [
  'submitted_for_approval',
  'approved',
  'supplier_notified',
  'preparing',
  'ready_to_ship',
  'in_transit',
  'delivered',
  'goods_receipt_pending',
  'goods_receipt_completed',
  'stock_entry_pending',
  'completed',
  'archived',
];

const STATUS_LABELS = Object.fromEntries(STATUS_DEFINITIONS.map((item) => [item.status, item.label]));

const getOrderId = (status) => `po-lifecycle-${status}`;

const getOrderNumber = (index) => `PO-LIFE-${String(index + 1).padStart(3, '0')}`;

const getHistoryPath = (status) => {
  if (status === 'cancelled') return ['submitted_for_approval', 'approved', 'cancelled'];
  const index = FULL_FLOW.indexOf(status);
  return FULL_FLOW.slice(0, index + 1);
};

const addHours = (date, hours) => new Date(date.getTime() + (hours * 60 * 60 * 1000));

const buildTimeline = (status, index) => {
  const base = new Date(Date.UTC(2026, 4, 1 + index, 7, 0, 0));
  return getHistoryPath(status).map((step, stepIndex) => ({
    status: step,
    at: addHours(base, stepIndex * 3).toISOString(),
    by: ACTOR_ID,
    note: stepIndex === 0
      ? 'Lifecycle test siparisi olusturuldu.'
      : `Lifecycle test akisi: ${STATUS_LABELS[step] || step}.`,
  }));
};

const resolveFlags = (status, history) => {
  const has = (value) => history.some((row) => row.status === value);
  const at = (value) => history.find((row) => row.status === value)?.at || null;
  return {
    approvedAt: at('approved'),
    deliveredAt: at('delivered'),
    completedAt: has('completed') || has('archived') ? at('completed') || at('archived') : null,
    archivedAt: status === 'archived' ? at('archived') : null,
    goodsReceiptCompleted: has('goods_receipt_completed') || has('stock_entry_pending') || has('completed') || has('archived'),
    stockEntryMode: has('stock_entry_pending') ? 'manual' : (has('completed') || has('archived') ? 'auto' : null),
    stockEntryCompleted: has('completed') || has('archived'),
    archived: status === 'archived',
  };
};

const toDecimalNumber = (value, fallback = 1) => {
  const numeric = Number(value || fallback);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
};

const main = async () => {
  const prisma = await getPrisma();
  const supplierProducts = await prisma.supplierProduct.findMany({
    where: {
      productId: { not: null },
      supplierId: { not: null },
      isActive: { not: false },
      product: { is: { isActive: { not: false } } },
      supplier: { is: { isActive: { not: false } } },
    },
    take: STATUS_DEFINITIONS.length,
    orderBy: [{ productId: 'asc' }, { supplierId: 'asc' }],
    include: {
      product: { select: { id: true, name: true, sku: true, unit: true } },
      supplier: { select: { id: true, name: true } },
    },
  });

  if (!supplierProducts.length) {
    throw new Error('Lifecycle test siparisi icin aktif tedarikci-urun eslesmesi bulunamadi.');
  }

  const orderIds = STATUS_DEFINITIONS.map((item) => getOrderId(item.status));
  await prisma.$transaction([
    prisma.purchaseOrderActivityLog.deleteMany({ where: { orderId: { in: orderIds } } }),
    prisma.purchaseOrderStatusHistory.deleteMany({ where: { orderId: { in: orderIds } } }),
    prisma.purchaseOrderItem.deleteMany({ where: { orderId: { in: orderIds } } }),
  ]);

  const created = [];
  for (const [index, definition] of STATUS_DEFINITIONS.entries()) {
    const { status, label } = definition;
    const supplierProduct = supplierProducts[index % supplierProducts.length];
    const orderId = getOrderId(status);
    const orderNumber = getOrderNumber(index);
    const history = buildTimeline(status, index);
    const firstAt = history[0].at;
    const lastAt = history[history.length - 1].at;
    const quantity = Math.max(1, Number(supplierProduct.minimumOrderQty || supplierProduct.minOrderQty || 3));
    const unitPrice = toDecimalNumber(supplierProduct.purchasePrice, 10);
    const subtotal = Number((quantity * unitPrice).toFixed(2));
    const taxAmount = Number((subtotal * 0.1).toFixed(2));
    const shippingFee = 75 + (index * 5);
    const grandTotal = Number((subtotal + taxAmount + shippingFee).toFixed(2));
    const flags = resolveFlags(status, history);

    await prisma.purchaseOrder.upsert({
      where: { id: orderId },
      create: {
        id: orderId,
        orderNumber,
        supplierId: supplierProduct.supplierId,
        source: SOURCE,
        status,
        currentStatus: status,
        currency: supplierProduct.currency || 'TRY',
        subtotalAmount: subtotal,
        taxAmount,
        shippingFee,
        discountAmount: 0,
        grandTotal,
        totalAmount: grandTotal,
        deliveryStatus: label,
        goodsReceiptCompleted: flags.goodsReceiptCompleted,
        stockEntryMode: flags.stockEntryMode,
        stockEntryCompleted: flags.stockEntryCompleted,
        archived: flags.archived,
        createdBy: ACTOR_ID,
        warehouseCity: 'Izmir',
        deliveryLocation: 'Ana Depo',
        orderReason: 'lifecycle_control',
        priority: index % 3 === 0 ? 'high' : 'normal',
        logisticsProvider: 'Shelfio Lojistik',
        trackingNo: `TRK-LIFE-${String(index + 1).padStart(3, '0')}`,
        estimatedDeliveryDate: addHours(new Date(firstAt), 48).toISOString().slice(0, 10),
        payload: {
          testPurpose: 'Siparis takip ve lifecycle ekran kontrolu',
          statusHistory: history,
          activityLog: history.map((row, rowIndex) => ({
            type: rowIndex === 0 ? 'created' : 'status_change',
            status: row.status,
            at: row.at,
            by: row.by,
            note: row.note,
            source: SOURCE,
          })),
          productSnapshot: {
            productId: supplierProduct.productId,
            productName: supplierProduct.product?.name,
            sku: supplierProduct.product?.sku,
            supplierName: supplierProduct.supplier?.name,
          },
        },
        createdAt: new Date(firstAt),
        updatedAt: new Date(lastAt),
        approvedAt: flags.approvedAt ? new Date(flags.approvedAt) : null,
        deliveredAt: flags.deliveredAt ? new Date(flags.deliveredAt) : null,
        completedAt: flags.completedAt ? new Date(flags.completedAt) : null,
        archivedAt: flags.archivedAt ? new Date(flags.archivedAt) : null,
      },
      update: {
        supplierId: supplierProduct.supplierId,
        source: SOURCE,
        status,
        currentStatus: status,
        currency: supplierProduct.currency || 'TRY',
        subtotalAmount: subtotal,
        taxAmount,
        shippingFee,
        discountAmount: 0,
        grandTotal,
        totalAmount: grandTotal,
        deliveryStatus: label,
        goodsReceiptCompleted: flags.goodsReceiptCompleted,
        stockEntryMode: flags.stockEntryMode,
        stockEntryCompleted: flags.stockEntryCompleted,
        archived: flags.archived,
        createdBy: ACTOR_ID,
        warehouseCity: 'Izmir',
        deliveryLocation: 'Ana Depo',
        orderReason: 'lifecycle_control',
        priority: index % 3 === 0 ? 'high' : 'normal',
        logisticsProvider: 'Shelfio Lojistik',
        trackingNo: `TRK-LIFE-${String(index + 1).padStart(3, '0')}`,
        estimatedDeliveryDate: addHours(new Date(firstAt), 48).toISOString().slice(0, 10),
        payload: {
          testPurpose: 'Siparis takip ve lifecycle ekran kontrolu',
          statusHistory: history,
          activityLog: history.map((row, rowIndex) => ({
            type: rowIndex === 0 ? 'created' : 'status_change',
            status: row.status,
            at: row.at,
            by: row.by,
            note: row.note,
            source: SOURCE,
          })),
          productSnapshot: {
            productId: supplierProduct.productId,
            productName: supplierProduct.product?.name,
            sku: supplierProduct.product?.sku,
            supplierName: supplierProduct.supplier?.name,
          },
        },
        createdAt: new Date(firstAt),
        updatedAt: new Date(lastAt),
        approvedAt: flags.approvedAt ? new Date(flags.approvedAt) : null,
        deliveredAt: flags.deliveredAt ? new Date(flags.deliveredAt) : null,
        completedAt: flags.completedAt ? new Date(flags.completedAt) : null,
        archivedAt: flags.archivedAt ? new Date(flags.archivedAt) : null,
      },
    });

    await prisma.purchaseOrderItem.create({
      data: {
        id: `poi-lifecycle-${status}`,
        orderId,
        productId: supplierProduct.productId,
        quantity,
        unitPrice,
        totalPrice: subtotal,
        unit: supplierProduct.defaultOrderUnit || supplierProduct.priceUnit || supplierProduct.product?.unit || 'adet',
        taxRate: 10,
        taxAmount,
        payload: {
          supplierProductId: supplierProduct.id,
          productName: supplierProduct.product?.name,
          supplierName: supplierProduct.supplier?.name,
          lifecycleStatus: status,
        },
        createdAt: new Date(firstAt),
        updatedAt: new Date(lastAt),
      },
    });

    for (const [rowIndex, row] of history.entries()) {
      await prisma.purchaseOrderStatusHistory.create({
        data: {
          id: `poh-lifecycle-${status}-${rowIndex + 1}`,
          orderId,
          status: row.status,
          at: new Date(row.at),
          by: row.by,
          note: row.note,
          payload: { source: SOURCE },
        },
      });
      await prisma.purchaseOrderActivityLog.create({
        data: {
          id: `poa-lifecycle-${status}-${rowIndex + 1}`,
          orderId,
          type: rowIndex === 0 ? 'created' : 'status_change',
          status: row.status,
          at: new Date(row.at),
          by: row.by,
          note: row.note,
          payload: { source: SOURCE },
        },
      });
    }

    created.push({
      status,
      orderId,
      orderNumber,
      supplierName: supplierProduct.supplier?.name,
      productName: supplierProduct.product?.name,
      historyLength: history.length,
    });
  }

  const counts = await prisma.purchaseOrder.groupBy({
    by: ['status'],
    where: { status: { in: STATUS_DEFINITIONS.map((item) => item.status) } },
    _count: { _all: true },
    orderBy: { status: 'asc' },
  });

  console.log(JSON.stringify({
    ok: true,
    canonicalStatuses: STATUS_DEFINITIONS.map((item) => item.status),
    created,
    counts: counts.map((row) => ({ status: row.status, count: row._count._all })),
  }, null, 2));
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectPrisma();
  });
