import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

export const ROUTE_TITLES = {
  '/anasayfa': 'Dashboard',
  '/urunler': 'Ürünler',
  '/kategoriler': 'Kategoriler',
  '/tedarikciler': 'Tedarikçiler',
  '/eslesmeler': 'Eşleşmeler',
  '/stok-islemleri': 'Stok İşlemleri',
  '/lokasyon-yonetimi': 'Lokasyon Yönetimi',
  '/depo-yonetimi': 'Depo Paneli',
  '/depo-transfer-talepleri': 'Depo Transfer Talepleri',
  '/gorev-planlama': 'Görev Planlama',
  '/bildirimler': 'Bildirimler',
  '/nasil-kullanilir': 'Nasıl Kullanılır',
  '/erisim-taleplerim': 'Erişim Taleplerim',
  '/erisim-talepleri': 'Erişim Talepleri',
  '/barkod-islemleri': 'Barkod İşlemleri',
  '/etiket-yonetimi': 'Etiket Yönetimi',
  '/raporlar': 'Raporlar',
  '/fiyat-talep-analizi': 'Fiyat & Talep Analizi',
  '/kampanya-yonetimi': 'Kampanya Yönetimi',
  '/siparis-onerileri': 'Sipariş Önerileri',
  '/siparis-takibi': 'Sipariş Takibi',
  '/siparis-olustur': 'Sipariş Oluştur',
  '/tedarikci-urunleri': 'Tedarikçi Ürünleri',
  '/personel-yonetimi': 'Personel Yönetimi',
  '/rol-yonetimi': 'Rol Yönetimi',
  '/musteri-yonetimi': 'Müşteri Yönetimi',
  '/proximity-yonetimi': 'Proximity Yönetimi',
  '/sistem-ayarlari': 'Sistem Ayarları',
  '/pos-kasa': 'POS / Kasa',
  '/giris': 'Giriş',
  '/login': 'Giriş',
  '/gizlilik-politikasi': 'Shelfio Gizlilik Politikası',
  '/musteri': 'Shelfio Müşteri Mobil',
  '/musteri/login': 'Müşteri Giriş',
  '/musteri/sepet': 'Sepet',
  '/musteri/hesabim': 'Hesabım',
  '/musteri/kampanyalar': 'Kampanyalar',
  '/musteri/favorilerim': 'Favorilerim',
  '/musteri/alisveris-listem': 'Alışveriş Listem',
  '/musteri/hediye-kartlari': 'Hediye Kartları',
  '/musteri/gecmis-siparisler': 'Geçmiş Siparişler',
  '/musteri/ayarlar': 'Ayarlar',
  '/musteri/magaza-calisma-saatleri': 'Mağaza Çalışma Saatleri',
  '/personel': 'Shelfio Personel Mobil',
  '/personel/bildirimler': 'Bildirimler',
  '/personel/gorevler': 'Görevler',
  '/personel/etiket-yonetimi': 'Etiket Yönetimi',
  '/personel/siparis-olustur': 'Sipariş Oluştur',
  '/personel/lokasyon-yonetimi': 'Lokasyon Yönetimi',
  '/personel/talep': 'Talep',
  '/kasa': 'Kasa',
};

const APP_NAME = 'Shelfio';

export function resolveRouteTitle(pathname) {
  const base = pathname.replace(/\/+$/, '') || '/';
  const match = ROUTE_TITLES[base] ?? findPartialMatch(base);
  if (match) return match;
  return deriveRouteTitle(base);
}

export function usePageTitle() {
  const { pathname } = useLocation();

  useEffect(() => {
    const title = resolveRouteTitle(pathname);
    document.title = title ? `${title} | ${APP_NAME}` : APP_NAME;
  }, [pathname]);
}

function findPartialMatch(pathname) {
  const sorted = Object.keys(ROUTE_TITLES).sort((a, b) => b.length - a.length);
  for (const route of sorted) {
    if (pathname.startsWith(route + '/') || pathname === route) {
      return ROUTE_TITLES[route];
    }
  }
  return null;
}

function deriveRouteTitle(pathname) {
  const clean = String(pathname || '')
    .replace(/\/+$/, '')
    .split('/')
    .filter(Boolean)
    .pop();
  if (!clean) return null;
  const human = clean
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!human) return null;
  return human.split(' ').map(word => word.charAt(0).toLocaleUpperCase('tr-TR') + word.slice(1).toLocaleLowerCase('tr-TR')).join(' ');
}
