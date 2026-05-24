import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, BookOpen, Cookie, FileText, LifeBuoy, Scale } from 'lucide-react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import Header from './Header.jsx';
import Sidebar from './Sidebar.jsx';
import AccessRequestModal from './AccessRequestModal.jsx';
import PageAccessGuard from './PageAccessGuard.jsx';
import FormModal from './FormModal.jsx';
import SupportRequestModal from './SupportRequestModal.jsx';
import Toast from './Toast.jsx';
import { SETTINGS_UPDATED_EVENT, settingsService } from '../services/settingsService.js';
import { accessService } from '../services/accessService.js';
import { useAuth } from '../hooks/useAuth.js';
import { usePageTitle } from '../hooks/usePageTitle.js';
import { resolvePageAccessRule } from '../config/pageAccessRules.js';
import { getRolePermissions, hasPermission } from '../config/permissions.js';
import { SUPPORT_CONTACT } from '../constants/contact.js';
import { COOKIE_POLICY_TEXT, openCookiePreferences } from './CookieConsent.jsx';

export const LEGAL_DOCUMENTS = {
  aydinlatma_metni: {
    title: 'Aydınlatma Metni',
    content: `Kişisel Verilerin Korunması Hakkında Aydınlatma Metni

İşbu Aydınlatma Metni, 6698 sayılı Kişisel Verilerin Korunması Kanunu (KVKK) uyarınca, veri sorumlusu sıfatıyla hareket eden Shelfio Stok Takip ve Elektronik Etiket Sistemleri Teknoloji A.Ş. tarafından, Shelfio platformunu kullanan kullanıcılar, personeller, tedarikçi yetkilileri ve ilgili kişiler bakımından kişisel verilerin işlenmesine ilişkin usul ve esaslar hakkında bilgilendirme amacıyla hazırlanmıştır.

Shelfio; küçük ve orta ölçekli mağazalar için geliştirilen, mağaza operasyonlarının tek bir platform üzerinden yönetilmesini amaçlayan bir yazılım altyapısıdır. Platform kapsamında; ürün yönetimi, stok yönetimi, satın alma ve tedarik süreçleri, POS/kasa işlemleri, operasyon görevleri, raporlama, elektronik raf etiketi yönetimi, kullanıcı yönetimi, sistem ayarları ve analiz süreçleri yürütülebilmektedir. Bu süreçlerin sağlıklı, güvenli ve verimli şekilde yürütülebilmesi amacıyla bazı kişisel veriler işlenebilmektedir.

1. Veri Sorumlusu

KVKK uyarınca kişisel verileriniz, veri sorumlusu olarak:

Shelfio Stok Takip ve Elektronik Etiket Sistemleri Teknoloji A.Ş.
Adres: Kazımdirik, 372. Sk.
E-posta: ${SUPPORT_CONTACT.email}

tarafından aşağıda açıklanan kapsamda işlenebilecektir.

2. İşlenen Kişisel Veriler

Shelfio platformunun kullanımı sırasında, hizmetin niteliğine ve kullanım şekline bağlı olarak aşağıdaki kişisel veriler işlenebilmektedir:

a) Kimlik ve kullanıcı bilgileri
- Ad soyad
- Kullanıcı adı
- Kullanıcı hesabına ilişkin tanımlayıcı bilgiler

b) İletişim bilgileri
- Telefon numarası
- E-posta adresi

c) Mesleki ve organizasyonel bilgiler
- Rol / yetki bilgisi
- Mağaza / şube bilgisi
- Kullanıcı tipi ve sistem içi yetkilendirme bilgileri

d) İşlem ve kullanım kayıtları

Kişisel verileriniz, Shelfio tarafından tamamen veya kısmen otomatik yollarla, elektronik ortamda aşağıdaki kanallar üzerinden toplanabilmektedir:

- Web sitesi
- Web yönetim paneli
- Mobil uygulama
- Kullanıcı kayıt ve giriş ekranları
- Sistem içi formlar
- Görev ve operasyon modülleri
- Satın alma, stok ve ürün yönetimi ekranları
- POS / kasa modülleri
- Elektronik raf etiketi entegrasyonları
- Teknik log mekanizmaları
- Çerezler ve benzeri teknolojiler
- Destek ve iletişim kanalları

Bu veriler, ilgili kişinin sisteme veri girmesi, sistemi kullanması, oturum açması, işlem gerçekleştirmesi, mobil uygulamayı kullanması, bildirim izni vermesi veya sistemin teknik çalışması sırasında otomatik olarak oluşabilir.

5. Kişisel Verilerin İşlenmesinin Hukuki Sebepleri

Kişisel verileriniz, KVKKÇTnın 5. maddesinde belirtilen veri işleme şartlarına dayanılarak işlenmektedir. Buna göre Shelfio, kişisel verileri aşağıdaki hukuki sebepler çerçevesinde işleyebilmektedir:

- Bir sözleşmenin kurulması veya ifasıyla doğrudan doğruya ilgili olması
- Veri sorumlusunun hukuki yükümlülüşünü yerine getirebilmesi için zorunlu olması
- Bir hakkın tesisi, kullanılması veya korunması için veri işlemenin zorunlu olması
- İlgili kişinin temel hak ve özgürlüklerine zarar vermemek kaydıyla veri sorumlusunun meşru menfaati için veri işlenmesinin zorunlu olması
- İlgili kişinin açık rızasının bulunması

Özellikle kampanya, bildirim, kişiselleştirilmiş iletişim veya lokasyon / yakınlık verisine dayalı bazı süreçlerde, ilgili mevzuat kapsamında gerekli olması halinde açık rıza alınabilmektedir.

6. Kişisel Verilerin Kimlere ve Hangi Amaçla Aktarılabileceşi

Kişisel verileriniz, yukarıda belirtilen işleme amaçlarının yerine getirilebilmesi doğrultusunda, ilgili mevzuata uygun olarak ve gerekli güvenlik önlemleri alınarak aşağıdaki taraflarla sınırlı olmak üzere paylaşılabilecektir:

- Kanunen yetkili kamu kurum ve kuruluşları
- Hukuken yetkili özel kişi veya kuruluşlar
- Teknik altyapı, bakım, destek, güvenlik ve yazılım hizmeti sunan iş ortakları veya hizmet sağlayıcılar
- Tedarik, satın alma ve operasyon süreçlerinin yürütülmesi için gerekli iş ortakları
- Destek, denetim, bilgi güvenliği ve operasyon yönetimi süreçlerinde görev alan yetkili kişiler

Kişisel verileriniz, yalnızca işleme amacı ile bağlantılı, sınırlı ve ölçülü olarak aktarılır.

Tarafınızca paylaşılan bilgiler doğrultusunda, Shelfio kapsamında işlenen kişisel verilerin yurt dışına aktarılmadığı kabul edilmektedir. İleride yurt dışı aktarımını gerektiren bir süreç doğması halinde, ilgili mevzuat çerçevesinde gerekli bilgilendirme ve yükümlülükler ayrıca yerine getirilecektir.

7. Kişisel Verilerin Saklanma Süresi

Kişisel verileriniz, ilgili mevzuatta öngörülen süreler boyunca veya işlendikleri amaç için gerekli olan süre kadar saklanmaktadır. Saklama süresi belirlenirken;

- ilgili yasal yükümlülükler
- sözleşmesel ilişkiler
- teknik gereklilikler
- operasyonel ihtiyaçlar
- olası uyuşmazlık durumları

dikkate alınmaktadır.

Saklama süresi sona eren kişisel veriler, ilgili mevzuata uygun olarak silinir, yok edilir veya anonim hale getirilir.`,
  },
  acik_riza_metni: {
    title: 'Açık Rıza Metni',
    content: `Açık Rıza Metni

İşbu Açık Rıza Metni, Shelfio Stok Takip ve Elektronik Etiket Sistemleri Teknoloji A.Ş. tarafından, 6698 sayılı Kişisel Verilerin Korunması Kanunu kapsamında, belirli veri işleme faaliyetlerine ilişkin açık rızanızın alınması amacıyla hazırlanmıştır.

Shelfio tarafından sunulan hizmetler kapsamında, temel platform hizmetlerinin dışında kalan bazı bildirim, kampanya, pazarlama ve kişiselleştirilmiş iletişim süreçlerinde kişisel verileriniz işlenebilmektedir. Bu kapsamda, açık rızanızı vermeniz halinde aşağıdaki verileriniz işlenebilir:

- telefon numarası
- e-posta adresi
- kampanya izin bilgileri
- lokasyon / yakınlık verisi

Lokasyon / yakınlık verisi, özellikle cihazınızın mağaza giriş alanı veya belirli fiziksel yakınlık noktalarında bluetooth trafiği üzerinden algılanması gibi teknik senaryolarda ve ilgili özelliğin aktif olması halinde işlenebilir.

Kişisel verileriniz aşağıdaki amaçlarla işlenebilir:
- kampanya, fırsat ve bilgilendirme içeriklerinin iletilmesi
- size özel bildirimlerin gönderilmesi
- mağaza yakınlığınıza göre bilgilendirme yapılması
- kişiselleştirilmiş kullanıcı deneyimi sunulması
- tanıtım ve iletişim süreçlerinin yürütülmesi

Açık rızanız, yalnızca yukarıda belirtilen amaçlarla sınırlı olarak kullanılacaktır.

Açık rızanın verilmesi tamamen sizin özgür iradenize bağlıdır. Açık rıza vermemeniz, Shelfio'nun temel hizmetlerinden yararlanmanızı tek başına engellemez. Ancak açık rızaya bağlı bazı kampanya, bildirim ve kişiselleştirilmiş hizmetlerden yararlanamamanıza neden olabilir.

Vermiş olduğunuz açık rızayı dilediğiniz zaman geri alabilirsiniz. Açık rızanın geri alınması, geri alma işleminden önce gerçekleştirilen veri işleme faaliyetlerinin hukuka uygunluğunu etkilemez.

Açık rızanızı geri almak veya bu kapsamda bilgi talebinde bulunmak için aşağıdaki iletişim bilgileri üzerinden bizimle iletişime geçebilirsiniz:

Shelfio Stok Takip ve Elektronik Etiket Sistemleri Teknoloji A.Ş.
Adres: Kazımdirik, 372. Sk.
E-posta: ${SUPPORT_CONTACT.email}

Bu metni onaylayarak, yukarıda belirtilen kişisel verilerimin belirtilen amaçlarla işlenmesine açık rıza verdişimi kabul ederim.`,
  },
  sartlar_ve_kosullar: {
    title: 'Şartlar ve Koşullar',
    content: `Şartlar ve Koşullar

İşbu Şartlar ve Koşullar metni, Shelfio Stok Takip ve Elektronik Etiket Sistemleri Teknoloji A.Ş. tarafından sunulan Shelfio platformunun kullanımına ilişkin esasları düzenlemektedir. Platformu kullanan her kullanıcı, işbu şartları kabul etmiş sayılır.

1. Hizmetin Kapsamı

Shelfio, küçük ve orta ölçekli mağazalara yönelik geliştirilen bir mağaza operasyon platformudur. Platform kapsamında; ürün yönetimi, stok yönetimi, POS / kasa işlemleri, tedarik ve satın alma süreçleri, operasyon görevleri, raporlama, elektronik raf etiketi yönetimi, kullanıcı yönetimi, sistem ayarları ve ilgili diğer operasyonel hizmetler sunulabilir.

Shelfio, hizmet kapsamını geliştirme, güncelleme, değiştirme, genişletme veya bazı modülleri kaldırma hakkını saklı tutar.

2. Kullanım Koşulları

Kullanıcılar, platformu yalnızca hukuka uygun amaçlarla ve hizmetin niteliğine uygun şekilde kullanmayı kabul eder.

Kullanıcı, Shelfio üzerinde oluşturduğu veya sisteme girdiği bilgilerin doğru, güncel ve gerektiğinde yetkili olduğu kapsamda kullanıldığını kabul eder.

Kullanıcı hesabı, kullanıcıya özeldir. Hesap bilgilerinin ve giriş bilgilerinin korunmasından kullanıcı sorumludur. Yetkisiz kullanım şüphesi doğuran durumlarda kullanıcı, durumu gecikmeksizin Shelfio'ya bildirmelidir.

3. Yasaklı Kullanımlar

Aşağıdaki kullanım biçimleri yasaktır:
- platforma yetkisiz erişim sağlamaya çalışmak
- sistemin güvenliğini zayıflatacak işlemler yapmak
- yanlış, yanıltıcı veya hukuka aykırı veri girişi yapmak
- hizmetin çalışmasını bozacak veya aksatacak teknik işlemler yürütmek
- başka kullanıcıların hesaplarına yetkisiz erişmeye çalışmak
- platformu mevzuata aykırı şekilde kullanmak
- sistemde yer alan içerik, veri veya yazılım unsurlarını izinsiz kopyalamak, çoşaltmak veya kötüye kullanmak

4. Kullanıcı Sorumluluşu

Kullanıcı, Shelfio platformunu kullanımından doğan işlemlerden kendi yetki ve sorumluluk alanı kapsamında sorumludur. Kullanıcı tarafından yapılan işlemler, güvenlik, denetim, hizmet sürekliliği ve operasyon takibi amacıyla kayıt altına alınabilir.

Shelfio, kullanıcıların sisteme girdiği verilerin doğruluğunu garanti etmez. Bu verilerin doğruluğu ve hukuka uygunluğu, ilgili kullanıcı veya kurumsal hesap sahibi tarafından sağlanmalıdır.

5. Hizmet Sürekliliği ve Değişiklik Hakkı

Shelfio, hizmetlerini sürekli ve güvenli şekilde sunmak için gerekli teknik önlemleri almaya çalışır. Bununla birlikte, bakım, güncelleme, teknik arıza, altyapı değişikliği, güvenlik gereklilikleri veya mücbir sebepler nedeniyle hizmette geçici kesintiler yaşanabilir.

Shelfio, platformun içeriğinde, arayüzünde, teknik yapısında, modüllerinde ve kullanım koşullarında önceden bildirimde bulunarak veya gerekli durumlarda bildirimde bulunmaksızın değişiklik yapma hakkını saklı tutar.

6. Fikri Mülkiyet

Shelfio platformuna ait yazılım, tasarım, arayüz, marka, logo, sistem yapısı, metinler, görseller, teknik unsurlar ve diğer tüm içerikler Shelfio Stok Takip ve Elektronik Etiket Sistemleri Teknoloji A.Ş.ÇTye veya ilgili hak sahiplerine aittir.

Kullanıcılar, bu içerikleri önceden yazılı izin olmaksızın kopyalayamaz, çoşaltamaz, dağıtamaz, ticari amaçla kullanamaz veya tersine mühendislik faaliyetlerine konu edemez.

7. Kişisel Veriler

Platformun kullanımı sırasında kişisel veriler, ilgili mevzuata uygun olarak işlenebilir. Kişisel verilerin işlenmesine ilişkin detaylı bilgi, Kişisel Verilerin Korunması Hakkında Aydınlatma Metni ve gerektiğinde Açık Rıza Metni içerisinde yer almaktadır.

Kullanıcı, platformu kullanarak bu metinleri okuduşunu ve ilgili hükümleri kabul ettişini beyan eder.

8. Sorumluluşun Sınırlandırılması

Shelfio, platformun kesintisiz, hatasız veya her özel ihtiyaca tamamen uygun şekilde çalışacaşını garanti etmez. Platform, mevcut haliyle sunulmaktadır.

Shelfio, kullanıcı hataları, yanlış veri girişleri, üçüncü taraf hizmetlerden kaynaklanan problemler, bağlantı sorunları, teknik arızalar veya mücbir sebepler nedeniyle doğabilecek dolaylı zararlardan sorumlu tutulamaz.

9. Uygulanacak Hukuk ve Yetki

İşbu Şartlar ve Koşullar metni Türkiye Cumhuriyeti hukuku kapsamında yorumlanır ve uygulanır. Taraflar arasında doğabilecek uyuşmazlıklarda, ilgili mevzuat hükümleri çerçevesinde yetkili mahkeme ve icra daireleri esas alınır.

10. İletişim

Şartlar ve Koşullar metni ile ilgili her türlü soru, görüş ve talepleriniz için aşağıdaki iletişim bilgileri üzerinden bizimle ulaşabilirsiniz:

Shelfio Stok Takip ve Elektronik Etiket Sistemleri Teknoloji A.Ş.
Adres: Kazımdirik, 372. Sk.
E-posta: ${SUPPORT_CONTACT.email}`,
  },
  cerez_politikasi: {
    title: 'Çerez Bilgilendirme Metni',
    content: COOKIE_POLICY_TEXT,
  },
};

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  usePageTitle();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [accessModalOpen, setAccessModalOpen] = useState(false);
  const [supportModalOpen, setSupportModalOpen] = useState(false);
  const [activeLegalDoc, setActiveLegalDoc] = useState(null);
  const [toast, setToast] = useState(null);
  const [settings, setSettings] = useState(null);
  const [effectivePermissions, setEffectivePermissions] = useState([]);
  const [pendingAccessRequests, setPendingAccessRequests] = useState([]);
  const permissionRedirectRef = useRef('');

  const handleGlobalBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate('/anasayfa');
  };

  useEffect(() => {
    const closeMenu = () => {
      if (window.innerWidth >= 992) {
        setIsSidebarOpen(false);
      }
    };

    window.addEventListener('resize', closeMenu);
    return () => window.removeEventListener('resize', closeMenu);
  }, []);

  const loadAccessContext = async () => {
    if (!user?.id) {
      setEffectivePermissions([]);
      setPendingAccessRequests([]);
      return;
    }
    const seededPermissions = getRolePermissions(user?.role);
    setEffectivePermissions(seededPermissions);
    try {
      const [permissionData, requestData] = await Promise.all([
        accessService.getEffectivePermissions(),
        accessService.listRequests(),
      ]);
      setEffectivePermissions(Array.isArray(permissionData?.effectivePermissions) ? permissionData.effectivePermissions : []);
      setPendingAccessRequests(Array.isArray(requestData) ? requestData : []);
    } catch {
      setEffectivePermissions([]);
      setPendingAccessRequests([]);
    }
  };

  useEffect(() => {
    loadAccessContext();
  }, [user?.id, user?.role]);

  useEffect(() => {
    if (!user?.id) return undefined;
    const timer = window.setInterval(() => {
      loadAccessContext();
    }, 30000);
    return () => window.clearInterval(timer);
  }, [user?.id]);

  const accessRule = resolvePageAccessRule(location.pathname);
  const effectiveAccessRule = accessRule;
  const resolvedPermissions = useMemo(() => {
    return effectivePermissions;
  }, [effectivePermissions]);
  const isBlockedByPermission = Boolean(
    effectiveAccessRule
    && !hasPermission(user, effectiveAccessRule.permission, resolvedPermissions)
  );
  const permissionRequestState = (() => {
    if (!effectiveAccessRule?.permission) return { hasPending: false, hasApproved: false };
    const rows = pendingAccessRequests.filter((item) => String(item.permission || '').trim() === effectiveAccessRule.permission);
    return {
      hasPending: rows.some((item) => String(item.status || '').toLowerCase() === 'pending'),
      hasApproved: rows.some((item) => String(item.effectiveStatus || item.status || '').toLowerCase() === 'active'),
    };
  })();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem('shelfio-theme');
    document.documentElement.removeAttribute('data-theme');
  }, []);

  const safeDefaultPath = useMemo(() => {
    const canAccess = (permission) => hasPermission(user, permission, resolvedPermissions);
    if (canAccess('report:view')) return '/anasayfa';
    if (canAccess('pos:view')) return '/pos-kasa';
    if (canAccess('transfer_request:view')) return '/depo-transfer-talepleri?fullscreen=1';
    if (canAccess('product:view')) return '/urunler';
    if (canAccess('category:view')) return '/kategoriler';
    if (canAccess('supplier:view')) return '/tedarikciler';
    if (canAccess('purchase:view')) return '/siparis-olustur';
    if (canAccess('task:view')) return '/gorev-planlama';
    if (canAccess('notification:view')) return '/bildirimler';
    if (canAccess('esl:view')) return '/etiket-yonetimi';
    if (canAccess('settings:view')) return '/sistem-ayarlari';
    return '/anasayfa';
  }, [resolvedPermissions, user]);

  useEffect(() => {
    if (!isBlockedByPermission || !effectiveAccessRule?.permission) {
      permissionRedirectRef.current = '';
      return;
    }
    if (location.pathname === '/rol-yonetimi') {
      permissionRedirectRef.current = '';
      return;
    }
    const currentPath = `${location.pathname}${location.search || ''}`;
    const redirectKey = `${currentPath}->${safeDefaultPath}`;
    if (permissionRedirectRef.current === redirectKey) return;
    permissionRedirectRef.current = redirectKey;
    if (currentPath !== safeDefaultPath) {
      navigate(safeDefaultPath, { replace: true });
    }
  }, [effectiveAccessRule?.permission, isBlockedByPermission, location.pathname, location.search, navigate, safeDefaultPath]);

  useEffect(() => {
    let active = true;

    const loadSettings = async () => {
      try {
        const data = await settingsService.get({ forceRefresh: true });
        if (active) {
          setSettings(data);
        }
      } catch {
        // noop: page title is route-driven by usePageTitle
      }
    };

    loadSettings();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handleSettingsUpdated = (event) => {
      if (!event?.detail) return;
      setSettings(event.detail);
    };
    window.addEventListener(SETTINGS_UPDATED_EVENT, handleSettingsUpdated);
    return () => window.removeEventListener(SETTINGS_UPDATED_EVENT, handleSettingsUpdated);
  }, []);

  const canRequestAccess = user?.role !== 'admin' && user?.isSuperUser !== true;
  const isLegalModalOpen = Boolean(activeLegalDoc);
  const legalModalTitle = activeLegalDoc ? LEGAL_DOCUMENTS[activeLegalDoc]?.title : '';
  const legalModalBody = activeLegalDoc ? LEGAL_DOCUMENTS[activeLegalDoc]?.content : '';
  const legalModalIcon = activeLegalDoc === 'sartlar_ve_kosullar' ?
    <Scale size={17} />
    : activeLegalDoc === 'cerez_politikasi' ?
      <Cookie size={17} />
      : <FileText size={17} />;

  const handleCloseLegalModal = () => {
    setActiveLegalDoc(null);
  };

  return (
    <div className="app-layout">
      <Toast toast={toast} onClose={() => setToast(null)} />
      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        settings={settings}
        effectivePermissions={resolvedPermissions}
      />

      <div className="content-shell">
        <Header
          onMenuClick={() => setIsSidebarOpen(true)}
          settings={settings}
          onOpenSupport={() => setSupportModalOpen(true)}
        />
        <main className="page-content">
          {isBlockedByPermission && `${location.pathname}${location.search || ''}` !== safeDefaultPath ? null : isBlockedByPermission ? (
            <PageAccessGuard
              permission={effectiveAccessRule?.permission}
              pageLabel={effectiveAccessRule?.label}
              requestState={permissionRequestState}
              onRequestStateRefresh={loadAccessContext}
              onOpenRequestModal={() => setAccessModalOpen(true)}
            />
          ) : <Outlet />}
        </main>
        <button
          type="button"
          className="app-global-back-btn"
          onClick={handleGlobalBack}
          aria-label="Önceki sayfaya geri dön"
          title={location.pathname === '/anasayfa' ? 'Önceki sayfaya dön veya ana ekranda kal' : 'Önceki sayfaya dön'}
        >
          <ArrowLeft size={16} />
        </button>
        {canRequestAccess ? (
          <button
            type="button"
            className="app-global-access-btn"
            onClick={() => setAccessModalOpen(true)}
          >
            Erişim Talep Et
          </button>
        ) : null}

        <footer className="app-footer">
          <div className="app-footer-left">
            <div className="app-footer-legal-row">
              <button
                type="button"
                className="app-footer-legal-link"
                onClick={() => setActiveLegalDoc('aydinlatma_metni')}
                aria-label="Aydınlatma Metnini aç"
              >
                <FileText size={13} /> Aydınlatma Metni
              </button>
                <button
                type="button"
                className="app-footer-legal-link"
                onClick={() => setActiveLegalDoc('acik_riza_metni')}
                aria-label="Açık Rıza Metnini aç"
              >
                <FileText size={13} /> Açık Rıza Metni
              </button>
              <button
                type="button"
                className="app-footer-legal-link"
                onClick={() => setActiveLegalDoc('sartlar_ve_kosullar')}
                aria-label="Şartlar ve Koşulları aç"
              >
                <Scale size={13} /> Şartlar ve Koşullar
              </button>
              <button
                type="button"
                className="app-footer-legal-link"
                onClick={openCookiePreferences}
                aria-label="Çerez tercihlerini aç"
              >
                <Cookie size={13} /> Çerez Tercihleri
              </button>
              <button
                type="button"
                className="app-footer-legal-link"
                onClick={() => setSupportModalOpen(true)}
                aria-label="Yardım talebi aç"
              >
                <LifeBuoy size={13} /> Yardım
              </button>
              <Link
                to="/nasil-kullanilir"
                className="app-footer-legal-link"
                aria-label="Nasıl Kullanılır sayfasını aç"
              >
                <BookOpen size={13} /> Nasıl Kullanılır
              </Link>
            </div>
          </div>
          <div className="app-footer-center">© 2026 Shelfio Stok ve Fiyat Yönetim Platformu. Tüm hakları saklıdır.</div>
          <div className="app-footer-right" aria-hidden="true" />
        </footer>
      </div>

      <AccessRequestModal
        isOpen={accessModalOpen}
        onClose={() => setAccessModalOpen(false)}
        initialPermission={effectiveAccessRule?.permission || ''}
        initialReason={effectiveAccessRule?.label ? `${effectiveAccessRule.label} için erişim talep ediyorum.` : ''}
        onSuccess={() => {
          if (user?.role === 'admin') {
            navigate('/erisim-talepleri');
            return;
          }
          navigate('/erisim-taleplerim');
        }}
      />

      <SupportRequestModal
        isOpen={supportModalOpen}
        onClose={() => setSupportModalOpen(false)}
        user={user}
        currentPath={`${location.pathname}${location.search || ''}`}
        onSuccess={() => setToast({ type: 'success', title: 'Destek', message: 'Talebiniz iletildi' })}
        onError={() => setToast({ type: 'error', title: 'Destek', message: 'Gönderilemedi, tekrar deneyin' })}
      />

      <FormModal
        isOpen={isLegalModalOpen}
        title={legalModalTitle}
        description="Yasal bilgilendirme alanı"
        headerIcon={legalModalIcon}
        onClose={handleCloseLegalModal}
        modalClassName="legal-info-modal"
      >
        <div className="legal-info-modal-body">
          <p className="legal-info-modal-text">{legalModalBody}</p>
        </div>
        <div className="legal-info-modal-actions">
          <button type="button" className="primary-button" onClick={handleCloseLegalModal}>Kapat</button>
        </div>
      </FormModal>
    </div>
  );
}
