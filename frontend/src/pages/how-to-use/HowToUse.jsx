import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  Bell,
  BookOpen,
  Boxes,
  BrainCircuit,
  ClipboardList,
  Database,
  LayoutDashboard,
  Link2,
  MapPinned,
  Megaphone,
  Monitor,
  PackageSearch,
  Receipt,
  Route,
  ScanBarcode,
  Search,
  Settings,
  Shield,
  ShieldPlus,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Tags,
  TabletSmartphone,
  Truck,
  UserCircle,
  Users,
  Wallet,
} from 'lucide-react';
import PageHeader from '../../components/PageHeader.jsx';
import { howToUseGuides, howToUseQuickActions } from '../../content/howToUseGuides.js';

const iconMap = {
  BarChart3,
  Bell,
  Boxes,
  BrainCircuit,
  ClipboardList,
  Database,
  LayoutDashboard,
  Link2,
  MapPinned,
  Megaphone,
  Monitor,
  PackageSearch,
  Receipt,
  Route,
  ScanBarcode,
  Settings,
  Shield,
  ShieldPlus,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Tags,
  TabletSmartphone,
  Truck,
  UserCircle,
  Users,
  Wallet,
};

const normalize = (value) => String(value || '').toLocaleLowerCase('tr-TR');

const guideSearchText = (guide) => normalize([
  guide.title,
  guide.group,
  guide.summary,
  guide.purpose,
  guide.route,
  ...(guide.capabilities || []),
  ...(guide.steps || []),
  ...(guide.warnings || []),
  ...(guide.tips || []),
  ...(guide.related || []),
  ...(guide.keywords || []),
].join(' '));

const quickActionSearchText = (action) => normalize([
  action.title,
  action.description,
  ...(action.keywords || []),
].join(' '));

export default function HowToUse() {
  const [query, setQuery] = useState('');
  const [selectedGuideId, setSelectedGuideId] = useState(howToUseGuides[0]?.id || '');
  const detailRef = useRef(null);

  const guideSearchIndex = useMemo(
    () => new Map(howToUseGuides.map((guide) => [guide.id, guideSearchText(guide)])),
    []
  );

  const normalizedQuery = normalize(query).trim();

  const visibleGuides = useMemo(() => {
    if (!normalizedQuery) return howToUseGuides;
    return howToUseGuides.filter((guide) => guideSearchIndex.get(guide.id)?.includes(normalizedQuery));
  }, [guideSearchIndex, normalizedQuery]);

  const visibleQuickActions = useMemo(() => {
    if (!normalizedQuery) return howToUseQuickActions;
    return howToUseQuickActions.filter((action) => {
      if (quickActionSearchText(action).includes(normalizedQuery)) return true;
      const guide = howToUseGuides.find((item) => item.id === action.guideId);
      return guide ? guideSearchIndex.get(guide.id)?.includes(normalizedQuery) : false;
    });
  }, [guideSearchIndex, normalizedQuery]);

  useEffect(() => {
    if (!visibleGuides.length) return;
    if (!visibleGuides.some((guide) => guide.id === selectedGuideId)) {
      setSelectedGuideId(visibleGuides[0].id);
    }
  }, [selectedGuideId, visibleGuides]);

  const selectedGuide = useMemo(
    () => howToUseGuides.find((guide) => guide.id === selectedGuideId) || visibleGuides[0] || howToUseGuides[0],
    [selectedGuideId, visibleGuides]
  );

  const groupedGuides = useMemo(() => {
    return visibleGuides.reduce((groups, guide) => {
      const key = guide.group || 'Diğer';
      if (!groups[key]) groups[key] = [];
      groups[key].push(guide);
      return groups;
    }, {});
  }, [visibleGuides]);

  const handleSelectGuide = (guideId) => {
    setSelectedGuideId(guideId);
    if (window.innerWidth < 900) {
      window.requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  };

  const selectQuickAction = (action) => {
    handleSelectGuide(action.guideId);
  };

  const SelectedIcon = iconMap[selectedGuide?.icon] || BookOpen;

  return (
    <div className="page-stack howto-page-layout">
      <PageHeader
        className="dashboard-hero howto-page-header"
        icon={<BookOpen size={22} />}
        title="Nasıl Kullanılır"
        description="Shelfio’daki ekranları ve işlem akışlarını adım adım öğrenin."
      />

      <section className="howto-search-panel" aria-label="Rehber arama">
        <label className="howto-search-box">
          <Search size={18} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Ürün ekleme, stok düzeltme, sipariş oluşturma, kampanya, POS..."
            aria-label="Rehberde ara"
          />
        </label>
        <div className="howto-search-meta">
          {visibleGuides.length} modül bulundu
        </div>
      </section>

      <section className="howto-quick-actions" aria-label="Hızlı işlem rehberleri">
        <div className="howto-section-head">
          <h2>Hızlı İşlem Kartları</h2>
          <p>En sık kullanılan akışlardan doğrudan ilgili rehbere geçin.</p>
        </div>
        <div className="howto-quick-grid">
          {visibleQuickActions.map((action) => {
            const guide = howToUseGuides.find((item) => item.id === action.guideId);
            const ActionIcon = iconMap[guide?.icon] || Sparkles;
            return (
              <button key={action.id} type="button" className="howto-quick-card" onClick={() => selectQuickAction(action)}>
                <span className="howto-quick-icon"><ActionIcon size={17} /></span>
                <strong>{action.title}</strong>
                <small>{action.description}</small>
              </button>
            );
          })}
          {!visibleQuickActions.length ? (
            <div className="howto-empty-inline">Aramanızla eşleşen hızlı işlem bulunamadı.</div>
          ) : null}
        </div>
      </section>

      <section className="howto-workspace">
        <aside className="howto-sidebar" aria-label="Modül seçici">
          <div className="howto-mobile-select">
            <label>
              <span>Modül / Sayfa Seç</span>
              <select value={selectedGuide?.id || ''} onChange={(event) => handleSelectGuide(event.target.value)} disabled={!visibleGuides.length}>
                {visibleGuides.map((guide) => (
                  <option key={guide.id} value={guide.id}>{guide.title}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="howto-module-list">
            {Object.entries(groupedGuides).map(([group, guides]) => (
              <div className="howto-module-group" key={group}>
                <h3>{group}</h3>
                {guides.map((guide) => {
                  const Icon = iconMap[guide.icon] || BookOpen;
                  const isActive = guide.id === selectedGuide?.id;
                  return (
                    <button
                      key={guide.id}
                      type="button"
                      className={`howto-module-button ${isActive ? 'is-active' : ''}`}
                      onClick={() => handleSelectGuide(guide.id)}
                    >
                      <Icon size={16} />
                      <span>{guide.title}</span>
                    </button>
                  );
                })}
              </div>
            ))}
            {!visibleGuides.length ? (
              <div className="howto-empty-inline">Bu aramaya uygun modül bulunamadı.</div>
            ) : null}
          </div>
        </aside>

        <article className="howto-detail" ref={detailRef}>
          {selectedGuide ? (
            <>
              <header className="howto-detail-header">
                <div className="howto-detail-icon" aria-hidden="true">
                  <SelectedIcon size={24} />
                </div>
                <div>
                  <span>{selectedGuide.group}</span>
                  <h2>{selectedGuide.title}</h2>
                  <p>{selectedGuide.summary}</p>
                  <a href={selectedGuide.route} className="howto-route-link">Sayfayı aç: {selectedGuide.route}</a>
                </div>
              </header>

              <div className="howto-info-grid">
                <section>
                  <h3>Bu Sayfa Ne İşe Yarar?</h3>
                  <p>{selectedGuide.purpose}</p>
                </section>
                <section>
                  <h3>İpuçları / Kısa Notlar</h3>
                  <ul>
                    {(selectedGuide.tips || []).map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </section>
              </div>

              <section className="howto-block">
                <h3>Bu Sayfada Neler Yapılabilir?</h3>
                <ul className="howto-check-list">
                  {(selectedGuide.capabilities || []).map((item) => <li key={item}>{item}</li>)}
                </ul>
              </section>

              <section className="howto-block">
                <h3>İşlem Adımları</h3>
                <ol className="howto-step-list">
                  {(selectedGuide.steps || []).map((item) => <li key={item}>{item}</li>)}
                </ol>
              </section>

              <section className="howto-block howto-warning-block">
                <h3>Uyarılar / Dikkat Edilecek Noktalar</h3>
                <ul>
                  {(selectedGuide.warnings || []).map((item) => <li key={item}>{item}</li>)}
                </ul>
              </section>

              <section className="howto-related">
                <h3>İlgili Diğer Sayfalar</h3>
                <div>
                  {(selectedGuide.related || []).map((item) => <span key={item}>{item}</span>)}
                </div>
              </section>
            </>
          ) : (
            <div className="howto-empty-state">
              <BookOpen size={28} />
              <h2>Rehber bulunamadı</h2>
              <p>Arama terimini değiştirerek tekrar deneyin.</p>
            </div>
          )}
        </article>
      </section>
    </div>
  );
}
