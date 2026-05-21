export const PAGE_ACCESS_RULES = [
  { path: '/anasayfa', pattern: /^\/anasayfa(?:\/|$)/, permission: 'report:view', label: 'Dashboard' },
  { path: '/urunler', pattern: /^\/urunler(?:\/|$)/, permission: 'product:view', label: 'Ürün Yönetimi' },
  { path: '/kategoriler', pattern: /^\/kategoriler(?:\/|$)/, permission: 'category:view', label: 'Kategoriler' },
  { path: '/eslesmeler', pattern: /^\/eslesmeler(?:\/|$)/, permission: 'supplier:view', label: 'Eşleşmeler' },
  { path: '/lokasyon-yonetimi', pattern: /^\/lokasyon-yonetimi(?:\/|$)/, permission: 'section:view', label: 'Lokasyon Yönetimi' },
  { path: '/stok-islemleri', pattern: /^\/stok-islemleri(?:\/|$)/, permission: 'stock:view', label: 'Stok İşlemleri' },
  { path: '/tedarikciler', pattern: /^\/tedarikciler(?:\/|$)/, permission: 'supplier:view', label: 'Tedarikçiler' },
  { path: '/siparis-olustur', pattern: /^\/siparis-olustur(?:\/|$)/, permission: 'purchase:view', label: 'Sipariş Oluştur' },
  { path: '/siparis-takibi', pattern: /^\/siparis-takibi(?:\/|$)/, permission: 'purchase:view', label: 'Sipariş Takibi' },
  { path: '/fiyat-talep-analizi', pattern: /^\/fiyat-talep-analizi(?:\/|$)/, permission: 'report:view', label: 'Fiyat ve Talep Analizi' },
  { path: '/kampanya-yonetimi', pattern: /^\/kampanya-yonetimi(?:\/|$)/, permission: 'settings:update', label: 'Kampanya Yönetimi' },
  { path: '/siparis-onerileri', pattern: /^\/siparis-onerileri(?:\/|$)/, permission: 'purchase:view', label: 'Sipariş Önerileri' },
  { path: '/raporlar', pattern: /^\/raporlar(?:\/|$)/, permission: 'report:view', label: 'Raporlar' },
  { path: '/gorev-planlama', pattern: /^\/gorev-planlama(?:\/|$)/, permission: 'task:view', label: 'Görev Planlama' },
  { path: '/bildirimler', pattern: /^\/bildirimler(?:\/|$)/, permission: 'notification:view', label: 'Bildirimler' },
  { path: '/etiket-yonetimi', pattern: /^\/etiket-yonetimi(?:\/|$)/, permission: 'esl:view', label: 'Etiket Yönetimi' },
  { path: '/personel-yonetimi', pattern: /^\/personel-yonetimi(?:\/|$)/, permission: 'user:view', label: 'Personel Yönetimi' },
  { path: '/musteri-yonetimi', pattern: /^\/musteri-yonetimi(?:\/|$)/, permission: 'user:view', label: 'Müşteri Yönetimi' },
  { path: '/proximity-yonetimi', pattern: /^\/proximity-yonetimi(?:\/|$)/, permission: 'proximity:view', label: 'Proximity Yönetimi' },
  { path: '/rol-yonetimi', pattern: /^\/rol-yonetimi(?:\/|$)/, permission: 'settings:update', label: 'Departmanlar' },
  { path: '/sistem-ayarlari', pattern: /^\/sistem-ayarlari(?:\/|$)/, permission: 'settings:view', label: 'Sistem Ayarları' },
  { path: '/pos-kasa', pattern: /^\/pos-kasa(?:\/|$)/, permission: 'pos:view', label: 'POS / Kasa' },
  { path: '/depo-transfer-talepleri', pattern: /^\/depo-transfer-talepleri(?:\/|$)/, permission: 'transfer_request:view', label: 'Depo Transfer Talepleri' },
];

export const resolvePageAccessRule = (pathname = '/') => {
  const route = PAGE_ACCESS_RULES.find((item) => item.pattern.test(String(pathname || '').trim()));
  return route || null;
};
