export const PURCHASE_ORDER_STATUSES = Object.freeze([
  'draft',
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
  'cancelled',
]);

export const PURCHASE_ORDER_STATUS_LABELS = Object.freeze({
  draft: 'Taslak',
  submitted_for_approval: 'Onaya Gönderildi',
  approved: 'Onaylandı',
  supplier_notified: 'Tedarikçiye İletildi',
  preparing: 'Hazırlanıyor',
  ready_to_ship: 'Sevke Hazır',
  in_transit: 'Yola Çıktı',
  delivered: 'Fiziksel Teslim Geldi',
  goods_receipt_pending: 'Mal Kabul Bekliyor',
  goods_receipt_completed: 'Mal Kabul Yapıldı',
  stock_entry_pending: 'Stok Girişi Bekleniyor',
  completed: 'Tamamlandı',
  archived: 'Arşivlendi',
  cancelled: 'İptal Edildi',
});

export const PURCHASE_ORDER_STATUS_CONTRACT = Object.freeze({
  draft: {
    meaning: 'Sipariş taslak olarak hazırlanır; tedarikçi veya onay akışına gönderilmemiştir.',
    visibleIn: ['Sipariş Oluştur', 'Sipariş Takibi'],
    next: ['submitted_for_approval', 'cancelled'],
    mode: 'manual',
    fields: ['status', 'currentStatus', 'current_status', 'deliveryStatus', 'updatedAt'],
  },
  submitted_for_approval: {
    meaning: 'Sipariş onay kuyruğundadır.',
    visibleIn: ['Sipariş Takibi', 'Dashboard', 'Raporlar'],
    next: ['approved', 'cancelled'],
    mode: 'manual',
    fields: ['status', 'currentStatus', 'current_status', 'deliveryStatus', 'updatedAt'],
  },
  approved: {
    meaning: 'Sipariş onaylandı; tedarikçiye iletim ve teslimat planı başlar.',
    visibleIn: ['Sipariş Takibi', 'Dashboard', 'Raporlar'],
    next: ['supplier_notified', 'cancelled'],
    mode: 'manual-entry-then-scheduler',
    fields: ['status', 'approvedAt', 'approvedBy', 'currentStatus', 'current_status', 'deliveryStatus', 'updatedAt'],
  },
  supplier_notified: {
    meaning: 'Tedarikçi siparişten haberdar edildi.',
    visibleIn: ['Sipariş Takibi', 'Dashboard', 'Raporlar'],
    next: ['preparing', 'cancelled'],
    mode: 'scheduler',
    fields: ['status', 'currentStatus', 'current_status', 'deliveryStatus', 'updatedAt'],
  },
  preparing: {
    meaning: 'Tedarikçi siparişi hazırlıyor.',
    visibleIn: ['Sipariş Takibi', 'Dashboard', 'Raporlar'],
    next: ['ready_to_ship', 'cancelled'],
    mode: 'scheduler',
    fields: ['status', 'currentStatus', 'current_status', 'deliveryStatus', 'updatedAt'],
  },
  ready_to_ship: {
    meaning: 'Sipariş sevkiyata hazır.',
    visibleIn: ['Sipariş Takibi', 'Dashboard', 'Raporlar'],
    next: ['in_transit', 'cancelled'],
    mode: 'scheduler',
    fields: ['status', 'currentStatus', 'current_status', 'deliveryStatus', 'updatedAt'],
  },
  in_transit: {
    meaning: 'Sipariş yoldadır.',
    visibleIn: ['Sipariş Takibi', 'Dashboard', 'Raporlar'],
    next: ['delivered', 'cancelled'],
    mode: 'scheduler',
    fields: ['status', 'currentStatus', 'current_status', 'deliveryStatus', 'deliveredAt', 'updatedAt'],
  },
  delivered: {
    meaning: 'Sipariş fiziksel olarak depoya/mağazaya ulaştı; mal kabul henüz tamamlanmadı.',
    visibleIn: ['Sipariş Takibi', 'Mal Kabul', 'Dashboard', 'Raporlar'],
    next: ['goods_receipt_pending'],
    mode: 'scheduler',
    fields: ['status', 'deliveredAt', 'goodsReceiptPendingAt', 'currentStatus', 'current_status', 'deliveryStatus', 'updatedAt'],
  },
  goods_receipt_pending: {
    meaning: 'Sipariş depoya ulaştı ve personel mal kabul kararı bekleniyor.',
    visibleIn: ['Sipariş Takibi', 'Mal Kabul', 'Dashboard', 'Raporlar'],
    next: ['goods_receipt_completed', 'cancelled'],
    mode: 'scheduler-created-manual-resolved',
    fields: ['status', 'goodsReceiptPendingAt', 'currentStatus', 'current_status', 'deliveryStatus', 'updatedAt'],
  },
  goods_receipt_completed: {
    meaning: 'Mal kabul kontrolü tamamlandı; stok girişi otomatik tamamlanabilir veya manuel bekleyebilir.',
    visibleIn: ['Sipariş Takibi', 'Mal Kabul', 'Raporlar'],
    next: ['stock_entry_pending', 'completed'],
    mode: 'manual',
    fields: ['status', 'goodsReceiptCompleted', 'goodsReceiptCompletedAt', 'currentStatus', 'current_status', 'deliveryStatus', 'updatedAt'],
  },
  stock_entry_pending: {
    meaning: 'Mal kabul tamamlandı, manuel stok girişi bekleniyor.',
    visibleIn: ['Sipariş Takibi', 'Stok İşlemleri', 'Raporlar'],
    next: ['completed', 'cancelled'],
    mode: 'manual',
    fields: ['status', 'stockEntryMode', 'stockEntryCompleted', 'stockEntryPendingAt', 'currentStatus', 'current_status', 'deliveryStatus', 'updatedAt'],
  },
  completed: {
    meaning: 'Mal kabul ve stok girişi tamamlandı; sipariş operasyonel olarak kapandı.',
    visibleIn: ['Sipariş Takibi', 'Dashboard', 'Raporlar'],
    next: ['archived'],
    mode: 'manual-or-system-after-stock-entry',
    fields: ['status', 'stockEntryCompleted', 'stockEntryCompletedAt', 'completedAt', 'currentStatus', 'current_status', 'deliveryStatus', 'updatedAt'],
  },
  archived: {
    meaning: 'Tamamlanan veya kapatılan sipariş aktif operasyon listesinden arşive alındı.',
    visibleIn: ['Sipariş Takibi', 'Raporlar'],
    next: [],
    mode: 'manual-or-system',
    fields: ['status', 'archived', 'archivedAt', 'currentStatus', 'current_status', 'deliveryStatus', 'updatedAt'],
  },
  cancelled: {
    meaning: 'Sipariş iptal edildi; aktif teslim/mal kabul akışı sonlandırıldı.',
    visibleIn: ['Sipariş Takibi', 'Dashboard', 'Raporlar'],
    next: ['archived'],
    mode: 'manual',
    fields: ['status', 'currentStatus', 'current_status', 'deliveryStatus', 'updatedAt'],
  },
});

export const PURCHASE_ORDER_ALLOWED_TRANSITIONS = Object.freeze(
  Object.fromEntries(Object.entries(PURCHASE_ORDER_STATUS_CONTRACT).map(([status, contract]) => [status, contract.next]))
);

export const LEGACY_PURCHASE_ORDER_STATUS_MAP = Object.freeze({
  approval_pending: 'submitted_for_approval',
  submitted: 'submitted_for_approval',
  sent_to_supplier: 'supplier_notified',
  supplier_sent: 'supplier_notified',
  shipped: 'in_transit',
  sourcing: 'preparing',
  delivery_planned: 'ready_to_ship',
  partially_delivered: 'delivered',
  closed: 'archived',
  return_in_progress: 'cancelled',
  canceled: 'cancelled',
  iptal: 'cancelled',
  iptal_edildi: 'cancelled',
});

export const CANONICAL_PURCHASE_ORDER_STATUS_SET = new Set(PURCHASE_ORDER_STATUSES);
export const PURCHASE_ORDER_AUTO_SEQUENCE = Object.freeze(['approved', 'supplier_notified', 'preparing', 'ready_to_ship', 'in_transit', 'delivered']);
export const PURCHASE_ORDER_AUTO_STATUSES = new Set(PURCHASE_ORDER_AUTO_SEQUENCE);
export const PURCHASE_ORDER_TERMINAL_STATUSES = new Set(['archived', 'cancelled']);
export const PURCHASE_ORDER_ACTIVE_STATUSES = new Set(PURCHASE_ORDER_STATUSES.filter((status) => !PURCHASE_ORDER_TERMINAL_STATUSES.has(status) && status !== 'completed'));
export const PURCHASE_ORDER_COMPLETED_STATUSES = new Set(['completed', 'archived']);
export const PURCHASE_ORDER_CANCELLED_STATUSES = new Set(['cancelled']);
export const PURCHASE_ORDER_WAITING_DELIVERY_STATUSES = new Set(['approved', 'supplier_notified', 'preparing', 'ready_to_ship', 'in_transit']);
export const PURCHASE_ORDER_GOODS_RECEIPT_STATUSES = new Set(['delivered', 'goods_receipt_pending', 'goods_receipt_completed', 'stock_entry_pending']);

export const normalizePurchaseOrderStatus = (value, fallback = 'submitted_for_approval') => {
  const raw = String(value || '').trim().toLocaleLowerCase('tr-TR');
  if (!raw) return fallback;
  const normalized = raw.replace(/ı/g, 'i').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const mapped = LEGACY_PURCHASE_ORDER_STATUS_MAP[normalized] || normalized;
  return CANONICAL_PURCHASE_ORDER_STATUS_SET.has(mapped) ? mapped : fallback;
};

export const getPurchaseOrderStatusLabel = (status) => PURCHASE_ORDER_STATUS_LABELS[normalizePurchaseOrderStatus(status)] || String(status || '-');

export const isPurchaseOrderDelayed = (order = {}, now = new Date()) => {
  const status = normalizePurchaseOrderStatus(order.status || order.currentStatus);
  if (PURCHASE_ORDER_TERMINAL_STATUSES.has(status) || PURCHASE_ORDER_COMPLETED_STATUSES.has(status)) return false;
  const eta = order.estimatedDeliveryDate || order.deliveredAtPlanned || order.payload?.estimatedDeliveryDate;
  if (!eta) return false;
  const due = new Date(eta);
  if (!Number.isFinite(due.getTime())) return false;
  return due.getTime() < now.getTime() && !PURCHASE_ORDER_GOODS_RECEIPT_STATUSES.has(status);
};

export const buildPurchaseOrderStatusMirrors = (status) => {
  const canonical = normalizePurchaseOrderStatus(status);
  return {
    status: canonical,
    currentStatus: canonical,
    current_status: canonical,
    deliveryStatus: getPurchaseOrderStatusLabel(canonical),
  };
};

export const canTransitionPurchaseOrderStatus = (fromStatus, toStatus) => {
  const from = normalizePurchaseOrderStatus(fromStatus);
  const to = normalizePurchaseOrderStatus(toStatus);
  if (from === to) return true;
  return (PURCHASE_ORDER_ALLOWED_TRANSITIONS[from] || []).includes(to);
};
