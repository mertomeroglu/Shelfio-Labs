import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Shield, 
  MapPin, 
  Camera, 
  Bell, 
  Cookie, 
  Lock, 
  Mail, 
  ArrowLeft, 
  FileText, 
  Users, 
  Eye, 
  Database, 
  Share2, 
  CheckCircle,
  HelpCircle
} from 'lucide-react';
import logoPng from '../../assets/logo.png';

export default function PrivacyPolicy() {
  const navigate = useNavigate();

  useEffect(() => {
    // Set dynamic page title
    document.title = "Shelfio Gizlilik Politikası";

    // Create or update meta description for SEO & Play Store compliance
    let metaDesc = document.querySelector('meta[name="description"]');
    if (!metaDesc) {
      metaDesc = document.createElement('meta');
      metaDesc.name = 'description';
      document.head.appendChild(metaDesc);
    }
    metaDesc.content = "Shelfio mobil ve web uygulamalarına ilişkin gizlilik politikası";

    // Scroll to top on load
    window.scrollTo(0, 0);
  }, []);

  const handleGoBack = () => {
    // Try to go back in history, or redirect to home/login if no history
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate('/giris');
    }
  };

  return (
    <div style={styles.pageContainer}>
      {/* Dynamic Style Tag for Custom Animations & Theme Overrides */}
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .privacy-card {
          animation: fadeIn 0.4s ease-out forwards;
        }
        .section-hover {
          transition: all 0.25s ease;
        }
        .section-hover:hover {
          border-color: var(--primary) !important;
          background: color-mix(in srgb, var(--primary) 2%, var(--panel)) !important;
        }
        .back-btn:hover {
          background: var(--border) !important;
          transform: translateX(-3px);
        }
      `}} />

      {/* Header Container */}
      <header style={styles.header}>
        <div style={styles.headerContent}>
          <button 
            onClick={handleGoBack} 
            className="back-btn" 
            style={styles.backButton}
            title="Geri Dön"
          >
            <ArrowLeft size={18} />
            <span>Geri Dön</span>
          </button>
          
          <div style={styles.brandContainer}>
            <img src={logoPng} alt="Shelfio" style={styles.logo} />
          </div>
        </div>
      </header>

      {/* Main Document Body */}
      <main className="privacy-card" style={styles.mainContent}>
        
        {/* Title Block */}
        <div style={styles.titleBlock}>
          <div style={styles.titleIconContainer}>
            <Shield size={38} style={styles.titleIcon} />
          </div>
          <h1 style={styles.title}>Gizlilik Politikası</h1>
          <p style={styles.lastUpdated}>Son Güncelleme: 29 Mayıs 2026</p>
          <div style={styles.divider}></div>
        </div>

        {/* Short Summary Callout (Play Console requirement helper) */}
        <div style={styles.calloutCard}>
          <div style={styles.calloutIconWrap}>
            <CheckCircle size={20} color="var(--primary)" />
          </div>
          <div style={styles.calloutTextWrap}>
            <strong>Özet Bilgilendirme</strong>
            <p style={{ margin: '4px 0 0', fontSize: '0.88rem', color: 'var(--muted)', lineHeight: '1.45' }}>
              Bu gizlilik politikası, Shelfio mobil ve web uygulamalarının cihaz yetkilerini, veri toplama yöntemlerini ve güvenlik önlemlerini açıklamaktadır. Uygulamalarımız, kullanıcı girişleri, mağaza operasyonları, ürün sayımları ve Bluetooth (BLE) yakınlık algılama (Proximity) teknolojileri dışında herhangi bir veri işlememektedir.
            </p>
          </div>
        </div>

        {/* Sections */}
        <div style={styles.sectionsContainer}>

          {/* Section 1: Giriş */}
          <section className="section-hover" style={styles.sectionCard}>
            <h2 style={styles.sectionTitle}>
              <FileText size={20} style={styles.sectionIcon} />
              1. Giriş
            </h2>
            <p style={styles.paragraph}>
              Shelfio Stok Takip ve Fiyat Yönetim Platformu ("Shelfio" veya "Sistem") olarak kişisel verilerinizin güvenliği ve gizliliği en büyük önceliğimizdir. Bu Gizlilik Politikası, Shelfio web uygulaması ile Shelfio Müşteri ve Personel mobil uygulamalarını ("Uygulamalar") kullanan müşterilerin, personellerin, yöneticilerin ve tedarikçilerin verilerinin toplanma, işlenme ve saklanma süreçlerini net bir şekilde açıklamak amacıyla hazırlanmıştır.
            </p>
            <p style={styles.paragraph}>
              Uygulamalarımızı kullanarak veya platforma erişerek, bu politikada yer alan hususları ve veri kullanım yöntemlerini kabul etmiş olursunuz.
            </p>
          </section>

          {/* Section 2: Toplanan Bilgiler */}
          <section className="section-hover" style={styles.sectionCard}>
            <h2 style={styles.sectionTitle}>
              <Database size={20} style={styles.sectionIcon} />
              2. Toplanan Bilgiler
            </h2>
            <p style={styles.paragraph}>
              Shelfio, mağaza operasyonlarının kesintisiz yürütülmesi ve kullanıcı deneyiminin optimize edilmesi amacıyla yalnızca gerekli ve asgari düzeyde verileri toplar. Toplanan veri kategorileri şunlardır:
            </p>
            <ul style={styles.bulletList}>
              <li style={styles.bulletItem}>
                <strong>Kullanıcı Kimlik ve Giriş Bilgileri:</strong> Uygulamalara kaydolurken veya giriş yaparken kullanılan kullanıcı adı, e-posta adresi, şifre ve rol bilgileri.
              </li>
              <li style={styles.bulletItem}>
                <strong>Operasyonel ve Mağaza Verileri:</strong> Ürünler, stok miktarları, reyon konumları, fiyat analizleri, sipariş detayları, stok hareketleri ve etiket güncelleme geçmişleri.
              </li>
              <li style={styles.bulletItem}>
                <strong>Cihaz Bilgileri:</strong> Uygulamalarımızın güvenliğini ve kararlılığını sağlamak için toplanan cihaz modeli, işletim sistemi sürümü, benzersiz cihaz tanımlayıcıları (UUID) ve ekran çözünürlüğü.
              </li>
              <li style={styles.bulletItem}>
                <strong>Proximity ve Sinyal Verileri:</strong> Müşteri mobil uygulamasının mağaza içi Bluetooth (BLE) Beacon cihazları ile kurduğu etkileşim verileri (sinyal gücü, yakınlık alanı, beacon kodu).
              </li>
            </ul>
          </section>

          {/* Section 3: Bilgilerin Kullanım Amaçları */}
          <section className="section-hover" style={styles.sectionCard}>
            <h2 style={styles.sectionTitle}>
              <Eye size={20} style={styles.sectionIcon} />
              3. Bilgilerin Kullanım Amaçları
            </h2>
            <p style={styles.paragraph}>
              Elde edilen veriler aşağıda belirtilen amaçlar doğrultusunda işlenmektedir:
            </p>
            <ul style={styles.bulletList}>
              <li style={styles.bulletItem}>Mağaza içi operasyonların (stok sayımı, raf yerleşimi, sipariş takibi) yürütülmesi ve yönetimi.</li>
              <li style={styles.bulletItem}>Elektronik Raf Etiketlerinin (ESL) güncel ürün ve fiyat bilgiileri ile eşleştirilmesi ve kablosuz köprüler (bridge) aracılığıyla güncellenmesi.</li>
              <li style={styles.bulletItem}>Bluetooth (BLE) Beacon altyapısı sayesinde müşterilerin mağaza içinde doğru reyonlara yönlendirilmesi ve konum tabanlı akıllı kampanya bildirimlerinin gönderilmesi.</li>
              <li style={styles.bulletItem}>Kullanıcı yetkilendirmesi, oturum yönetimi ve yetkisiz erişimlerin engellenmesi ile sistem güvenliğinin sağlanması.</li>
              <li style={styles.bulletItem}>Hata logları ve performans verilerinin analizi ile uygulamaların kararlılığının artırılması.</li>
            </ul>
          </section>

          {/* Section 4: Mobil Uygulama Kullanımı */}
          <section className="section-hover" style={styles.sectionCard}>
            <h2 style={styles.sectionTitle}>
              <Users size={20} style={styles.sectionIcon} />
              4. Mobil Uygulama Kullanımı
            </h2>
            <p style={styles.paragraph}>
              Shelfio mobil uygulamaları iki farklı kullanıcı grubuna yönelik deneyim sunar:
            </p>
            <ul style={styles.bulletList}>
              <li style={styles.bulletItem}>
                <strong>Shelfio Müşteri Mobil Uygulaması:</strong> Müşterilerin mağaza içinde gezinirken ürünleri tarayabilmesini, favori listeleri oluşturabilmesini, güncel kampanyaları görebilmesini ve BLE Beacon teknolojisi ile reyon bazlı indirimlerden anında haberdar olabilmesini sağlar.
              </li>
              <li style={styles.bulletItem}>
                <strong>Shelfio Personel Mobil Uygulaması:</strong> Mağaza çalışanlarının etiket eşleştirmesi, ürün sayımı yapması, stok hareketlerini kaydetmesi, reyon besleme ve sipariş yönetimi görevlerini mobil ortamda gerçekleştirebilmesi için tasarlanmıştır.
              </li>
            </ul>
          </section>

          {/* Section 5: Cihaz ve Bildirim İzinleri */}
          <section className="section-hover" style={styles.sectionCard}>
            <h2 style={styles.sectionTitle}>
              <Lock size={20} style={styles.sectionIcon} />
              5. Cihaz ve Bildirim İzinleri
            </h2>
            <p style={styles.paragraph}>
              Uygulamalarımızın tam ve verimli çalışabilmesi için cihazınızda aşağıdaki izinlerin etkinleştirilmesi gerekmektedir. Bu izinlerin her biri yalnızca ilgili fonksiyonun yerine getirilmesi amacıyla kullanılır:
            </p>
            
            <div style={styles.permissionSubCard}>
              <div style={styles.permissionHead}>
                <MapPin size={18} color="var(--primary)" style={{ marginRight: 8 }} />
                <strong>Konum İzni (Arka Plan Konumu Dahil)</strong>
              </div>
              <p style={{ margin: '6px 0 0', fontSize: '0.9rem', color: 'var(--muted)', lineHeight: '1.45' }}>
                Müşteri mobil uygulamasında yer alan Proximity (BLE Beacon) kampanya akışlarının çalışabilmesi için konum erişimi zorunludur. Bluetooth düşük enerji (BLE) sinyallerinin taranması işletim sistemleri tarafından konum yetkisine bağlıdır. Arka planda konum izni, uygulama kapalıyken bile mağazadaki bir indirim reyonuna yaklaştığınızda akıllı fırsat bildirimlerinin size ulaştırılabilmesini sağlar. Konum verileriniz hiçbir şekilde izlenmez, sunucularımızda saklanmaz veya harita üzerinde kaydedilmez.
              </p>
            </div>

            <div style={styles.permissionSubCard}>
              <div style={styles.permissionHead}>
                <Camera size={18} color="var(--primary)" style={{ marginRight: 8 }} />
                <strong>Kamera İzni</strong>
              </div>
              <p style={{ margin: '6px 0 0', fontSize: '0.9rem', color: 'var(--muted)', lineHeight: '1.45' }}>
                Hem müşteri hem de personel uygulamalarında, ürünlerin barkodlarını ve Elektronik Etiketlerin (ESL) üzerindeki karekodları (QR kod) hızlıca tarayarak sistemle eşleştirmek amacıyla cihazın kamera donanımına erişim istenir. Kamera görüntüsü sadece anlık tarama işlemi için işlenir, fotoğraf veya video olarak kaydedilmez.
              </p>
            </div>

            <div style={styles.permissionSubCard}>
              <div style={styles.permissionHead}>
                <Bell size={18} color="var(--primary)" style={{ marginRight: 8 }} />
                <strong>Bildirim İzni</strong>
              </div>
              <p style={{ margin: '6px 0 0', fontSize: '0.9rem', color: 'var(--muted)', lineHeight: '1.45' }}>
                Personele atanan yeni operasyonel görevlerin (stok sayımı, raf düzeltme), kritik skt/son tüketim tarihi yaklaşan ürün uyarılarının veya müşterilere özel anlık indirim kampanyalarının anında iletilmesi için bildirim gönderme yetkisi istenir. Dilediğiniz zaman cihaz ayarlarından bu izni kapatabilirsiniz.
              </p>
            </div>
          </section>

          {/* Section 6: Çerezler ve Benzeri Teknolojiler */}
          <section className="section-hover" style={styles.sectionCard}>
            <h2 style={styles.sectionTitle}>
              <Cookie size={20} style={styles.sectionIcon} />
              6. Çerezler ve Benzeri Teknolojiler
            </h2>
            <p style={styles.paragraph}>
              Web tabanlı platformumuzda kullanıcıların oturumlarını korumak, güvenlik tercihlerini saklamak ve sistemin çalışma performansını analiz etmek amacıyla oturum çerezleri (session cookies) ve yerel depolama (local storage) teknolojileri kullanılır. Kullanıcılar çerez tercihlerini Çerez Bildirimi panelinden istedikleri zaman özelleştirebilirler. Zorunlu çerezler dışındaki çerezlerin kullanımı tamamen kullanıcının onayına bağlıdır.
            </p>
          </section>

          {/* Section 7: Verilerin Saklanması */}
          <section className="section-hover" style={styles.sectionCard}>
            <h2 style={styles.sectionTitle}>
              <Database size={20} style={styles.sectionIcon} />
              7. Verilerin Saklanması
            </h2>
            <p style={styles.paragraph}>
              Shelfio bünyesinde toplanan tüm kişisel ve operasyonel veriler, en yüksek güvenlik standartlarına sahip güvenli yerel/bulut sunucularda ve PostgreSQL tabanlı veritabanlarında saklanır. Verileriniz, işlenme amaçlarının gerektirdiği süre boyunca ve yasal saklama süreleri (örneğin ticari mevzuat yükümlülükleri) sınırları dahilinde muhafaza edilir. Amacı kalmayan veya saklama süresi dolan veriler güvenli bir şekilde silinir, yok edilir veya anonim hale getirilir.
            </p>
          </section>

          {/* Section 8: Verilerin Paylaşılması */}
          <section className="section-hover" style={styles.sectionCard}>
            <h2 style={styles.sectionTitle}>
              <Share2 size={20} style={styles.sectionIcon} />
              8. Verilerin Paylaşılması
            </h2>
            <p style={styles.paragraph}>
              Shelfio, kullanıcılarına ait verileri hiçbir koşulda üçüncü şahıslara satmaz, kiralamaz veya ticari amaçlarla paylaşmaz. Verileriniz yalnızca şu durumlarda paylaşılabilir:
            </p>
            <ul style={styles.bulletList}>
              <li style={styles.bulletItem}>
                <strong>Yasal Yükümlülükler:</strong> Yetkili kamu kurum ve kuruluşları ile adli makamlardan gelen resmi ve yasal taleplerin yerine getirilmesi amacıyla kanuni sınırlar çerçevesinde.
              </li>
              <li style={styles.bulletItem}>
                <strong>Hizmet Sağlayıcılar:</strong> Altyapı, push bildirim gönderimi (örneğin Firebase) veya sunucu barındırma hizmetleri aldığımız iş ortaklarımızla, yalnızca hizmetin sunulabilmesi için gereken asgari veri miktarı ile sınırlandırılmak ve gizlilik sözleşmeleri akdedilmek kaydıyla.
              </li>
            </ul>
          </section>

          {/* Section 9: Kullanıcı Hakları */}
          <section className="section-hover" style={styles.sectionCard}>
            <h2 style={styles.sectionTitle}>
              <Users size={20} style={styles.sectionIcon} />
              9. Kullanıcı Hakları (KVKK / GDPR)
            </h2>
            <p style={styles.paragraph}>
              6698 sayılı Kişisel Verilerin Korunması Kanunu (KVKK) uyarınca, verilerinizin işlenip işlenmediğini öğrenme, işlenmişse buna ilişkin bilgi talep etme, işlenme amacına uygun kullanılıp kullanılmadığını öğrenme, verilerin düzeltilmesini veya silinmesini isteme haklarına sahipsiniz. Haklarınızı kullanmak ve kişisel verilerinizin silinmesini talep etmek için bizimle <strong>info@shelfiolabs.com</strong> adresi üzerinden her zaman iletişime geçebilirsiniz.
            </p>
          </section>

          {/* Section 10: Veri Güvenliği */}
          <section className="section-hover" style={styles.sectionCard}>
            <h2 style={styles.sectionTitle}>
              <Lock size={20} style={styles.sectionIcon} />
              10. Veri Güvenliği
            </h2>
            <p style={styles.paragraph}>
              Verilerinizin yetkisiz kişilerin eline geçmesini, kaybolmasını veya zarar görmesini engellemek amacıyla endüstri standartlarında teknik ve idari güvenlik önlemleri uygulamaktayız. Ağ trafiğimiz SSL/TLS protokolleri ile şifrelenir, veritabanı erişimleri sıkı yetkilendirme katmanları ile denetlenir ve sunucularımız düzenli güvenlik taramalarından geçirilir. Ancak, internet üzerinden yapılan hiçbir iletimin veya elektronik depolama yönteminin %100 güvenli olmadığı unutulmamalıdır; bu doğrultuda sistemimizi korumak için en son güvenlik protokollerini sürekli entegre etmekteyiz.
            </p>
          </section>

          {/* Section 11: Üçüncü Taraf Servisler */}
          <section className="section-hover" style={styles.sectionCard}>
            <h2 style={styles.sectionTitle}>
              <Share2 size={20} style={styles.sectionIcon} />
              11. Üçüncü Taraf Servisler
            </h2>
            <p style={styles.paragraph}>
              Uygulamalarımız içerisinde yer alan harita modülleri, bildirim dağıtım ağları (Google Firebase) ve analitik izleme araçları gibi bazı servisler üçüncü taraflarca sağlanır. Bu servis sağlayıcıların kendi gizlilik politikaları geçerlidir ve Shelfio bu platformların veri toplama pratiklerinden doğrudan sorumlu tutulamaz. İlgili servislerin gizlilik kurallarını incelemenizi öneririz.
            </p>
          </section>

          {/* Section 12: Politika Değişiklikleri */}
          <section className="section-hover" style={styles.sectionCard}>
            <h2 style={styles.sectionTitle}>
              <HelpCircle size={20} style={styles.sectionIcon} />
              12. Politika Değişiklikleri
            </h2>
            <p style={styles.paragraph}>
              Sistem geliştirmelerine, yeni yasal düzenlemelere veya Play Store politikalarına uyum sağlamak adına bu Gizlilik Politikası zaman zaman güncellenebilir. Politikada yapılan değişiklikler yürürlüğe girdiği tarihten itibaren geçerli olur. Sayfanın en üstünde yer alan "Son Güncelleme" tarihini kontrol ederek güncellemeler hakkında bilgi sahibi olabilirsiniz.
            </p>
          </section>

          {/* Section 13: İletişim */}
          <section className="section-hover" style={{ ...styles.sectionCard, borderLeftColor: 'var(--primary)', borderLeftWidth: 4 }}>
            <h2 style={styles.sectionTitle}>
              <Mail size={20} style={styles.sectionIcon} />
              13. İletişim ve Veri Silme Talepleri
            </h2>
            <p style={styles.paragraph}>
              Bu Gizlilik Politikası ile ilgili her türlü sorunuz, görüşünüz veya kişisel verilerinizin silinmesine/güncellenmesine yönelik talepleriniz için bizimle aşağıdaki e-posta adresi üzerinden iletişime geçebilirsiniz:
            </p>
            <div style={styles.contactContainer}>
              <Mail size={18} color="var(--primary)" style={{ marginRight: 10 }} />
              <a href="mailto:info@shelfiolabs.com" style={styles.emailLink}>
                info@shelfiolabs.com
              </a>
            </div>
          </section>

        </div>
      </main>

      {/* Standalone Footer */}
      <footer style={styles.footer}>
        <p style={{ margin: 0 }}>© 2026 Shelfio Stok ve Fiyat Yönetim Platformu. Tüm Hakları Saklıdır.</p>
        <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--muted)' }}>Google Play Store & KVKK Gizlilik Politikası Bağlantısı</p>
      </footer>
    </div>
  );
}

// Inline Styles (Premium Theme Support & Responsiveness using HSL / Native CSS Variables)
const styles = {
  pageContainer: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--bg)',
    color: 'var(--text)',
    fontFamily: '"Inter", sans-serif',
    padding: 0,
    margin: 0,
  },
  header: {
    background: 'var(--panel)',
    borderBottom: '1px solid var(--border)',
    position: 'sticky',
    top: 0,
    zIndex: 100,
    boxShadow: 'var(--shadow)',
  },
  headerContent: {
    maxWidth: '1000px',
    margin: '0 auto',
    padding: '12px 20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  },
  backButton: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    background: 'var(--panel-soft)',
    border: '1px solid var(--border)',
    color: 'var(--text)',
    padding: '8px 14px',
    borderRadius: 'var(--radius-sm)',
    fontSize: '0.88rem',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  brandContainer: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  logo: {
    height: '28px',
    width: 'auto',
    objectFit: 'contain',
  },
  brandName: {
    fontSize: '1.15rem',
    fontWeight: 800,
    color: 'var(--primary)',
    letterSpacing: '-0.3px',
  },
  mainContent: {
    flex: '1 0 auto',
    maxWidth: '840px',
    width: '92%',
    margin: '36px auto',
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    padding: 'clamp(20px, 5vw, 44px)',
    boxShadow: 'var(--shadow-hover)',
  },
  titleBlock: {
    textAlign: 'center',
    marginBottom: '28px',
  },
  titleIconContainer: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '74px',
    height: '74px',
    borderRadius: '20px',
    background: 'color-mix(in srgb, var(--primary) 10%, var(--panel))',
    marginBottom: '16px',
  },
  titleIcon: {
    color: 'var(--primary)',
  },
  title: {
    fontSize: 'clamp(1.75rem, 4vw, 2.25rem)',
    fontWeight: 800,
    letterSpacing: '-0.8px',
    margin: '0 0 8px 0',
    color: 'var(--text)',
  },
  lastUpdated: {
    fontSize: '0.9rem',
    color: 'var(--muted)',
    margin: 0,
  },
  divider: {
    height: '2px',
    background: 'linear-gradient(90deg, transparent, var(--border-subtle), transparent)',
    margin: '20px 0 0 0',
  },
  calloutCard: {
    display: 'flex',
    gap: '12px',
    background: 'color-mix(in srgb, var(--primary) 5%, var(--panel))',
    border: '1px solid var(--primary-soft)',
    borderRadius: 'var(--radius-md)',
    padding: '16px',
    marginBottom: '32px',
    textAlign: 'left',
  },
  calloutIconWrap: {
    flexShrink: 0,
    marginTop: '2px',
  },
  calloutTextWrap: {
    fontSize: '0.94rem',
  },
  sectionsContainer: {
    display: 'grid',
    gap: '24px',
  },
  sectionCard: {
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
    padding: '24px',
    textAlign: 'left',
    background: 'var(--panel)',
  },
  sectionTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    fontSize: '1.2rem',
    fontWeight: 700,
    margin: '0 0 14px 0',
    color: 'var(--text)',
    borderBottom: '1px solid var(--border)',
    paddingBottom: '10px',
  },
  sectionIcon: {
    color: 'var(--primary)',
    flexShrink: 0,
  },
  paragraph: {
    fontSize: '0.96rem',
    color: 'color-mix(in srgb, var(--text) 88%, transparent)',
    lineHeight: '1.65',
    margin: '0 0 12px 0',
  },
  bulletList: {
    paddingLeft: '20px',
    margin: '0 0 16px 0',
  },
  bulletItem: {
    fontSize: '0.95rem',
    lineHeight: '1.6',
    color: 'color-mix(in srgb, var(--text) 85%, transparent)',
    marginBottom: '10px',
  },
  permissionSubCard: {
    background: 'var(--panel-soft)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    padding: '16px',
    marginTop: '12px',
  },
  permissionHead: {
    display: 'flex',
    alignItems: 'center',
    fontSize: '0.94rem',
    fontWeight: 700,
    color: 'var(--text)',
  },
  contactContainer: {
    display: 'inline-flex',
    alignItems: 'center',
    background: 'var(--panel-soft)',
    border: '1px solid var(--border)',
    padding: '10px 16px',
    borderRadius: 'var(--radius-sm)',
    marginTop: '8px',
  },
  emailLink: {
    color: 'var(--primary)',
    fontWeight: 700,
    textDecoration: 'none',
    fontSize: '0.95rem',
  },
  footer: {
    textAlign: 'center',
    padding: '24px 20px',
    borderTop: '1px solid var(--border)',
    background: 'var(--panel)',
    fontSize: '0.88rem',
    color: 'var(--muted)',
    marginTop: 'auto',
  }
};
