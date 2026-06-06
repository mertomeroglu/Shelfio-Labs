export const MODULE_LABELS_TR = {
  dashboard: 'Dashboard',
  products: 'Ürünler',
  categories: 'Kategoriler',
  users: 'Personel Yönetimi',
  settings: 'Ayarlar',
  pos: 'POS / Kasa',
  stock: 'Stok İşlemleri',
  permissions: 'Rol Yönetimi',
  suppliers: 'Tedarikçiler',
  notifications: 'Bildirimler',
  warehouse: 'Lokasyon / Depo Yönetimi',
  stock_batches: 'SKT Takibi',
  stock_movements: 'Depo Transfer Talepleri',
  tasks: 'Görev Planlama',
  reports: 'Raporlar',
  report: 'Raporlar',
  procurement: 'Sipariş Önerileri',
  purchase_orders: 'Sipariş Takibi / Sipariş Oluştur',
  campaigns: 'Kampanya Yönetimi',
  campaign: 'Kampanya Yönetimi',
  proximity: 'Proximity Yönetimi',
  esl: 'Etiket Yönetimi',
  customers: 'Müşteri Yönetimi',
  customer_mobile: 'Müşteri Mobil',
  personnel_mobile: 'Personel Yönetimi',
  support: 'Destek',
};

export const getModuleLabelTr = (value, fallback = '') => {
  const key = String(value || '').trim().toLowerCase();
  return MODULE_LABELS_TR[key] || fallback || String(value || '').replace(/_/g, ' ');
};
