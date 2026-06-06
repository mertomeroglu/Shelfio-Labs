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

export const PURCHASE_ORDER_STATUS_HELP = Object.freeze({
  draft: 'Sipariş taslak olarak hazırlanıyor.',
  submitted_for_approval: 'Sipariş onay kuyruğunda.',
  approved: 'Sipariş onaylandı; tedarikçi iletişim akışı başlar.',
  supplier_notified: 'Tedarikçi siparişten haberdar edildi.',
  preparing: 'Tedarikçi siparişi hazırlıyor.',
  ready_to_ship: 'Sipariş sevkiyata hazır.',
  in_transit: 'Sipariş yolda.',
  delivered: 'Sipariş fiziksel olarak depoya ulaştı; mal kabul henüz yapılmadı.',
  goods_receipt_pending: 'Depo mal kabul kararını bekliyor.',
  goods_receipt_completed: 'Mal kabul tamamlandı; stok etkisi sıradaki adımdır.',
  stock_entry_pending: 'Manuel stok girişi bekleniyor.',
  completed: 'Stok etkisi işlendi; operasyon tamamlandı.',
  archived: 'Sipariş arşive taşındı.',
  cancelled: 'Sipariş iptal edildi.',
});

export const PURCHASE_ORDER_ALLOWED_TRANSITIONS = Object.freeze({
  draft: ['submitted_for_approval', 'cancelled'],
  submitted_for_approval: ['approved', 'cancelled'],
  approved: ['supplier_notified', 'cancelled'],
  supplier_notified: ['preparing', 'cancelled'],
  preparing: ['ready_to_ship', 'cancelled'],
  ready_to_ship: ['in_transit', 'cancelled'],
  in_transit: ['delivered', 'cancelled'],
  delivered: ['goods_receipt_pending'],
  goods_receipt_pending: ['goods_receipt_completed', 'cancelled'],
  goods_receipt_completed: ['stock_entry_pending', 'completed'],
  stock_entry_pending: ['completed', 'cancelled'],
  completed: ['archived'],
  archived: [],
  cancelled: ['archived'],
});

export const PURCHASE_ORDER_STATUS_TONES = Object.freeze({
  draft: 'neutral',
  submitted_for_approval: 'warning',
  approved: 'primary',
  supplier_notified: 'primary',
  preparing: 'warning',
  ready_to_ship: 'warning',
  in_transit: 'primary',
  delivered: 'success',
  goods_receipt_pending: 'warning',
  goods_receipt_completed: 'success',
  stock_entry_pending: 'warning',
  completed: 'success',
  archived: 'neutral',
  cancelled: 'danger',
});

export const LEGACY_PURCHASE_ORDER_STATUS_MAP = Object.freeze({
  approval_pending: 'submitted_for_approval',
  pending: 'submitted_for_approval',
  submitted: 'submitted_for_approval',
  awaiting_approval: 'submitted_for_approval',
  pending_approval: 'submitted_for_approval',
  onaya_gonderildi: 'submitted_for_approval',
  sent_to_supplier: 'supplier_notified',
  supplier_sent: 'supplier_notified',
  ordered: 'supplier_notified',
  tedarikciye_iletildi: 'supplier_notified',
  shipped: 'in_transit',
  yolda: 'in_transit',
  arrived: 'delivered',
  partially_received: 'goods_receipt_pending',
  received: 'goods_receipt_completed',
  mal_kabul: 'goods_receipt_pending',
  sourcing: 'preparing',
  delivery_planned: 'ready_to_ship',
  partially_delivered: 'delivered',
  closed: 'archived',
  return_in_progress: 'cancelled',
  canceled: 'cancelled',
  rejected: 'cancelled',
  iptal: 'cancelled',
  iptal_edildi: 'cancelled',
  iptal_edildi_: 'cancelled',
  tamamlandi: 'completed',
  arsiv: 'archived',
  arsivlendi: 'archived',
});

export const PURCHASE_ORDER_STATUS_SEQUENCE = PURCHASE_ORDER_STATUSES;
export const PURCHASE_ORDER_LIFECYCLE_ORDER = PURCHASE_ORDER_STATUSES;
export const VISIBLE_PURCHASE_ORDER_STATUS_SEQUENCE = Object.freeze([
  'submitted_for_approval',
  'supplier_notified',
  'preparing',
  'ready_to_ship',
  'in_transit',
  'goods_receipt_pending',
  'goods_receipt_completed',
  'stock_entry_pending',
  'completed',
  'cancelled',
]);
export const HIDDEN_PURCHASE_ORDER_STEPPER_STATUSES = new Set(['draft', 'approved', 'delivered', 'archived']);
export const PURCHASE_ORDER_VISIBLE_STATUS_MAP = Object.freeze({
  draft: 'submitted_for_approval',
  approved: 'submitted_for_approval',
  delivered: 'goods_receipt_pending',
  archived: 'completed',
});
export const PURCHASE_ORDER_MANUAL_ACTION_TRANSITIONS = Object.freeze({
  draft: ['submitted_for_approval', 'cancelled'],
  submitted_for_approval: ['approved', 'cancelled'],
  approved: ['cancelled'],
  supplier_notified: ['cancelled'],
  preparing: ['cancelled'],
  ready_to_ship: ['cancelled'],
  in_transit: ['cancelled'],
  delivered: [],
  goods_receipt_pending: ['goods_receipt_completed', 'cancelled'],
  goods_receipt_completed: ['stock_entry_pending', 'completed'],
  stock_entry_pending: ['completed', 'cancelled'],
  completed: [],
  archived: [],
  cancelled: [],
});
export const PURCHASE_ORDER_WAITING_DELIVERY_STATUSES = new Set(['approved', 'supplier_notified', 'preparing', 'ready_to_ship', 'in_transit']);
export const PURCHASE_ORDER_GOODS_RECEIPT_STATUSES = new Set(['delivered', 'goods_receipt_pending', 'goods_receipt_completed']);
export const PURCHASE_ORDER_STOCK_ENTRY_STATUSES = new Set(['stock_entry_pending']);
export const PURCHASE_ORDER_COMPLETED_STATUSES = new Set(['completed']);
export const PURCHASE_ORDER_ARCHIVED_STATUSES = new Set(['archived']);
export const PURCHASE_ORDER_CANCELLED_STATUSES = new Set(['cancelled']);

export const normalizePurchaseOrderStatus = (value, fallback = 'submitted_for_approval') => {
  const raw = String(value || '').trim().toLocaleLowerCase('tr-TR');
  if (!raw) return fallback;
  const normalized = raw
    .replace(/ı/g, 'i')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  const mapped = LEGACY_PURCHASE_ORDER_STATUS_MAP[normalized] || normalized;
  return PURCHASE_ORDER_STATUSES.includes(mapped) ? mapped : fallback;
};

export const getPurchaseOrderStatusLabel = (status) => PURCHASE_ORDER_STATUS_LABELS[normalizePurchaseOrderStatus(status)] || String(status || '-');

export const getPurchaseOrderStatusTone = (status) => PURCHASE_ORDER_STATUS_TONES[normalizePurchaseOrderStatus(status)] || 'neutral';

export const getPurchaseOrderStatusHelp = (status) => PURCHASE_ORDER_STATUS_HELP[normalizePurchaseOrderStatus(status)] || 'Bu durum için açıklama tanımlı değil.';

export const getPurchaseOrderAllowedTransitions = (status) => PURCHASE_ORDER_ALLOWED_TRANSITIONS[normalizePurchaseOrderStatus(status)] || [];

export const mapPurchaseOrderStatusToVisibleStatus = (status) => {
  const canonical = normalizePurchaseOrderStatus(status);
  return PURCHASE_ORDER_VISIBLE_STATUS_MAP[canonical] || canonical;
};

export const getVisiblePurchaseOrderStatusLabel = (status) => getPurchaseOrderStatusLabel(mapPurchaseOrderStatusToVisibleStatus(status));

export const getPurchaseOrderManualActionTransitions = (status) => PURCHASE_ORDER_MANUAL_ACTION_TRANSITIONS[normalizePurchaseOrderStatus(status)] || [];

export const isPurchaseOrderDelayed = (order = {}, now = new Date()) => {
  const status = normalizePurchaseOrderStatus(order.status || order.currentStatus);
  if (
    PURCHASE_ORDER_GOODS_RECEIPT_STATUSES.has(status)
    || PURCHASE_ORDER_STOCK_ENTRY_STATUSES.has(status)
    || PURCHASE_ORDER_COMPLETED_STATUSES.has(status)
    || PURCHASE_ORDER_ARCHIVED_STATUSES.has(status)
    || PURCHASE_ORDER_CANCELLED_STATUSES.has(status)
  ) {
    return false;
  }
  const eta = order.estimatedDeliveryDate || order.deliveredAtPlanned || order.payload?.estimatedDeliveryDate;
  if (!eta) return false;
  const due = new Date(eta);
  return Number.isFinite(due.getTime()) && due.getTime() < now.getTime();
};
