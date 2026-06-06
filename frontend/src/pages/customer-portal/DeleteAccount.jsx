import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  UserX, 
  ArrowLeft, 
  ShieldAlert, 
  Trash2, 
  CheckCircle2, 
  AlertTriangle,
  Lock,
  User,
  KeyRound
} from 'lucide-react';
import { customerPortalAuthService } from '../../services/customerPortalAuthService.js';
import logoPng from '../../assets/logo.png';

export default function DeleteAccount() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ identifier: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    // Dynamic page title
    document.title = "Hesap Silme | Shelfio";

    // Dynamic meta description
    let metaDesc = document.querySelector('meta[name="description"]');
    if (!metaDesc) {
      metaDesc = document.createElement('meta');
      metaDesc.name = 'description';
      document.head.appendChild(metaDesc);
    }
    metaDesc.content = "Shelfio müşteri hesabı kalıcı silme işlemleri";
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((current) => ({ ...current, [name]: value }));
  };

  const handleGoBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate('/musteri');
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');

    if (!form.identifier.trim()) {
      setError('Kullanıcı adı, e-posta veya telefon alanı zorunludur.');
      return;
    }
    if (!form.password) {
      setError('Şifre alanı zorunludur.');
      return;
    }

    // Open confirmation modal first
    setModalOpen(true);
  };

  const handleConfirmDelete = async () => {
    setModalOpen(false);
    setLoading(true);
    setError('');

    try {
      await customerPortalAuthService.deleteAccount(form.identifier, form.password);
      setSuccess(true);
    } catch (err) {
      setError(err?.message || 'Hesap silme işlemi başarısız oldu. Lütfen bilgilerinizi kontrol edin.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.pageContainer}>
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-card {
          animation: slideUp 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        .btn-hover:hover {
          background: var(--border) !important;
          transform: translateX(-3px);
        }
        .btn-danger-hover:hover {
          background: #b91c1c !important;
          box-shadow: 0 4px 12px rgba(220, 38, 38, 0.25);
        }
      `}} />

      {/* Header Bar */}
      <header style={styles.header}>
        <div style={styles.headerContent}>
          <button 
            onClick={handleGoBack} 
            className="btn-hover" 
            style={styles.backButton}
            title="Geri Dön"
          >
            <ArrowLeft size={16} />
            <span>Geri Dön</span>
          </button>
          
          <div style={styles.brandContainer}>
            <img src={logoPng} alt="Shelfio" style={styles.logo} onError={(e) => {
              e.target.style.display = 'none';
            }} />
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="animate-card" style={styles.mainContent}>
        
        {success ? (
          /* Success Screen */
          <div style={styles.successWrapper}>
            <div style={styles.successIconOuter}>
              <CheckCircle2 size={44} color="#16a34a" />
            </div>
            <h2 style={styles.successTitle}>Hesabınız Silindi</h2>
            <p style={styles.successMessage}>
              Müşteri hesabınız ve hesabınızla ilişkili tüm kişisel verileriniz sistemimizden **anında ve kalıcı olarak** kaldırılmıştır.
            </p>
            <div style={styles.infoSummaryBox}>
              <ul style={{ ...styles.bulletList, margin: 0 }}>
                <li style={styles.bulletItem}>Profil ve iletişim verileriniz silinmiştir.</li>
                <li style={styles.bulletItem}>Oturumunuz kapatılmış ve tüm yetkilendirmeler iptal edilmiştir.</li>
                <li style={styles.bulletItem}>Ek saklama veya veri arşivleme süresi uygulanmamıştır.</li>
              </ul>
            </div>
            <button 
              onClick={() => navigate('/musteri')} 
              style={styles.primaryButton}
            >
              Müşteri Portalına Dön
            </button>
          </div>
        ) : (
          /* Input Form & Information Details */
          <div>
            <div style={styles.titleBlock}>
              <div style={styles.titleIconContainer}>
                <UserX size={34} color="#dc2626" />
              </div>
              <h1 style={styles.title}>Hesap Silme</h1>
              <p style={styles.subtitle}>
                Bu sayfa yalnızca Shelfio müşteri hesapları için kullanılır. Kullanıcı adı ve şifrenizi doğruladıktan sonra hesabınız kalıcı olarak silinir.
              </p>
              <div style={styles.divider}></div>
            </div>

            {error ? <div className="alert error" style={{ marginBottom: '20px' }}>{error}</div> : null}

            {/* Play Console Compliance Callout */}
            <div style={styles.complianceCard}>
              <div style={styles.complianceIconWrap}>
                <ShieldAlert size={20} color="#dc2626" />
              </div>
              <div style={styles.complianceTextWrap}>
                <h4 style={{ margin: '0 0 4px 0', fontSize: '0.94rem', fontWeight: 700, color: 'var(--text)' }}>
                  Önemli Bilgilendirme ve Veri Hakları
                </h4>
                <p style={{ margin: '0 0 8px 0', color: 'var(--muted)', fontSize: '0.86rem', lineHeight: '1.45' }}>
                  Hesabınız silindiğinde müşteri hesabınıza ait kişisel veriler <strong>anında silinir</strong>. Verileriniz anında silinir, ayrıca <strong>ek bir saklama süresi uygulanmaz</strong>.
                </p>
                <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.86rem', lineHeight: '1.45' }}>
                  Silme işlemi sonrası müşteri profiliniz, iletişim bilgileriniz, adres bilgileriniz, bildirim tercihleriniz ve oturum bilgileriniz sistemden tamamen kaldırılır. Bu işlem geri alınamaz.
                </p>
              </div>
            </div>

            {/* Form Fields */}
            <form onSubmit={handleSubmit} style={styles.form}>
              <div style={styles.inputGroup}>
                <label style={styles.label}>
                  <User size={15} style={styles.fieldIcon} />
                  Kullanıcı Adı, E-posta veya Telefon
                </label>
                <input 
                  type="text" 
                  name="identifier"
                  value={form.identifier} 
                  onChange={handleChange}
                  placeholder="Kullanıcı adı, e-posta veya telefon numarası"
                  className="customer-input"
                  style={styles.textInput}
                />
              </div>

              <div style={styles.inputGroup}>
                <label style={styles.label}>
                  <KeyRound size={15} style={styles.fieldIcon} />
                  Şifre
                </label>
                <input 
                  type="password" 
                  name="password"
                  value={form.password} 
                  onChange={handleChange}
                  placeholder="Hesap şifreniz"
                  className="customer-input"
                  style={styles.textInput}
                />
              </div>

              <button 
                type="submit" 
                className="btn-danger-hover" 
                style={styles.deleteButton}
                disabled={loading}
              >
                <Trash2 size={16} />
                <span>{loading ? 'İşleniyor...' : 'Hesabımı Sil'}</span>
              </button>
            </form>

            {/* Data Retention Summary Info Block */}
            <div style={styles.infoSummaryBox}>
              <h5 style={styles.infoBoxTitle}>Silinen & Saklanan Veri Türleri</h5>
              <div style={styles.infoBoxGrid}>
                <div>
                  <strong style={{ fontSize: '0.85rem', color: 'var(--text)' }}>Silinen Veriler:</strong>
                  <ul style={styles.bulletListCompact}>
                    <li>Müşteri hesabı</li>
                    <li>Profil bilgileri</li>
                    <li>İletişim bilgileri</li>
                    <li>Adres bilgileri</li>
                    <li>Bildirim tercihleri</li>
                    <li>Oturum/token bilgileri</li>
                  </ul>
                </div>
                <div>
                  <strong style={{ fontSize: '0.85rem', color: 'var(--text)' }}>Saklama Süresi:</strong>
                  <p style={{ margin: '6px 0 0', fontSize: '0.82rem', color: 'var(--muted)', lineHeight: '1.45' }}>
                    Ek saklama süresi yoktur. Silme işlemi onaylandığında ilgili müşteri kişisel verileri anında silinir.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Confirmation Modal */}
      {modalOpen ? (
        <div style={styles.modalOverlay}>
          <div style={styles.modalCard}>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
              <div style={styles.modalIconWrap}>
                <AlertTriangle size={24} color="#dc2626" />
              </div>
              <div>
                <h3 style={styles.modalTitle}>Hesabınızı kalıcı olarak silmek istiyor musunuz?</h3>
                <p style={styles.modalDescription}>
                  Bu işlem geri alınamaz. Müşteri hesabınız ve ilişkili kişisel verileriniz <strong>anında silinir</strong>. Ek saklama süresi uygulanmaz.
                </p>
              </div>
            </div>
            <div style={styles.modalActions}>
              <button 
                type="button" 
                onClick={() => setModalOpen(false)} 
                style={styles.modalCancelBtn}
              >
                Vazgeç
              </button>
              <button 
                type="button" 
                onClick={handleConfirmDelete} 
                className="btn-danger-hover" 
                style={styles.modalConfirmBtn}
              >
                Evet, Hesabımı Sil
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Public Footer */}
      <footer style={styles.footer}>
        <p style={{ margin: 0 }}>© 2026 Shelfio Stok ve Fiyat Yönetim Platformu. Tüm Hakları Saklıdır.</p>
        <p style={{ margin: '4px 0 0', fontSize: '0.78rem', color: 'var(--muted)' }}>Google Play Store Müşteri Hesap Silme Bağlantısı</p>
      </footer>
    </div>
  );
}

// Inline Styles mapped with HSL/Global Variables
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
    fontSize: '0.85rem',
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
    height: '26px',
    width: 'auto',
    objectFit: 'contain',
  },
  brandName: {
    fontSize: '1.1rem',
    fontWeight: 800,
    color: 'var(--primary)',
    letterSpacing: '-0.3px',
  },
  mainContent: {
    flex: '1 0 auto',
    maxWidth: '560px',
    width: '92%',
    margin: '40px auto',
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-lg)',
    padding: 'clamp(20px, 5vw, 36px)',
    boxShadow: 'var(--shadow-hover)',
    boxSizing: 'border-box',
  },
  titleBlock: {
    textAlign: 'center',
    marginBottom: '24px',
  },
  titleIconContainer: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '64px',
    height: '64px',
    borderRadius: '18px',
    background: '#fee2e2',
    marginBottom: '14px',
  },
  title: {
    fontSize: '1.65rem',
    fontWeight: 800,
    letterSpacing: '-0.5px',
    margin: '0 0 6px 0',
    color: 'var(--text)',
  },
  subtitle: {
    fontSize: '0.88rem',
    color: 'var(--muted)',
    lineHeight: '1.5',
    margin: '0 auto',
    maxWidth: '460px',
  },
  divider: {
    height: '1px',
    background: 'var(--border)',
    margin: '18px 0 0 0',
  },
  complianceCard: {
    display: 'flex',
    gap: '12px',
    background: '#fff5f5',
    border: '1px solid #fee2e2',
    borderRadius: 'var(--radius-md)',
    padding: '16px',
    marginBottom: '24px',
    textAlign: 'left',
  },
  complianceIconWrap: {
    flexShrink: 0,
    marginTop: '2px',
  },
  complianceTextWrap: {
    fontSize: '0.9rem',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
    textAlign: 'left',
  },
  inputGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  label: {
    fontSize: '0.85rem',
    fontWeight: 600,
    color: 'var(--text)',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
  },
  fieldIcon: {
    color: 'var(--muted)',
  },
  textInput: {
    minHeight: '40px',
    padding: '9px 12px',
    boxSizing: 'border-box',
  },
  deleteButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    background: '#dc2626',
    border: 'none',
    color: '#ffffff',
    padding: '12px 20px',
    borderRadius: 'var(--radius-md)',
    fontWeight: 700,
    fontSize: '0.95rem',
    cursor: 'pointer',
    marginTop: '10px',
    transition: 'all 0.2s ease',
  },
  infoSummaryBox: {
    marginTop: '28px',
    background: 'var(--panel-soft)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-md)',
    padding: '16px',
    textAlign: 'left',
  },
  infoBoxTitle: {
    margin: '0 0 10px 0',
    fontSize: '0.9rem',
    fontWeight: 700,
    color: 'var(--text)',
    borderBottom: '1px solid var(--border)',
    paddingBottom: '6px',
  },
  infoBoxGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: '16px',
  },
  bulletList: {
    paddingLeft: '16px',
    margin: '10px 0',
  },
  bulletListCompact: {
    paddingLeft: '14px',
    margin: '4px 0 0 0',
    fontSize: '0.82rem',
    color: 'var(--muted)',
    lineHeight: '1.45',
  },
  bulletItem: {
    fontSize: '0.88rem',
    color: 'var(--muted)',
    lineHeight: '1.5',
    marginBottom: '6px',
  },
  successWrapper: {
    textAlign: 'center',
    padding: '12px 0',
  },
  successIconOuter: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '74px',
    height: '74px',
    borderRadius: '50%',
    background: '#dcfce7',
    marginBottom: '16px',
  },
  successTitle: {
    fontSize: '1.5rem',
    fontWeight: 800,
    margin: '0 0 8px 0',
    color: 'var(--text)',
  },
  successMessage: {
    fontSize: '0.94rem',
    color: 'var(--muted)',
    lineHeight: '1.55',
    margin: '0 0 24px 0',
  },
  primaryButton: {
    background: 'var(--primary)',
    border: 'none',
    color: '#ffffff',
    padding: '12px 24px',
    borderRadius: 'var(--radius-md)',
    fontWeight: 700,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(15, 23, 42, 0.45)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 13000,
    padding: '16px',
  },
  modalCard: {
    width: '100%',
    maxWidth: '460px',
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: '16px',
    padding: '24px',
    boxShadow: 'var(--shadow-hover)',
    textAlign: 'left',
    boxSizing: 'border-box',
  },
  modalIconWrap: {
    flexShrink: 0,
    background: '#fee2e2',
    width: '40px',
    height: '40px',
    borderRadius: '10px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalTitle: {
    fontSize: '1.05rem',
    fontWeight: 800,
    color: 'var(--text)',
    margin: '0 0 8px 0',
    lineHeight: '1.4',
  },
  modalDescription: {
    fontSize: '0.86rem',
    color: 'var(--muted)',
    lineHeight: '1.5',
    margin: 0,
  },
  modalActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px',
    marginTop: '20px',
  },
  modalCancelBtn: {
    background: 'var(--panel-soft)',
    border: '1px solid var(--border)',
    color: 'var(--text)',
    padding: '10px 18px',
    borderRadius: 'var(--radius-sm)',
    fontWeight: 600,
    fontSize: '0.88rem',
    cursor: 'pointer',
  },
  modalConfirmBtn: {
    background: '#dc2626',
    border: 'none',
    color: '#ffffff',
    padding: '10px 18px',
    borderRadius: 'var(--radius-sm)',
    fontWeight: 700,
    fontSize: '0.88rem',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  footer: {
    textAlign: 'center',
    padding: '24px 20px',
    borderTop: '1px solid var(--border)',
    background: 'var(--panel)',
    fontSize: '0.85rem',
    color: 'var(--muted)',
    marginTop: 'auto',
  }
};
