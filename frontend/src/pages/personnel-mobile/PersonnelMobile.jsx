import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, AlertTriangle, Briefcase, CheckSquare, ClipboardList, ScanLine, Search, X } from 'lucide-react';
import { taskService } from '../../services/taskService.js';
import { userService } from '../../services/userService.js';
import { formatCurrency } from '../../services/formatters.js';
import { getDepotDisplayLabel, getProductDisplayPrice, getProductDisplayUnit } from '../../services/productService.js';
import { useAuth } from '../../hooks/useAuth.js';
import { usePersonnelProductSearch } from '../../hooks/usePersonnelProductSearch.js';
import { formatRecommendedOrderByUnit, getPrimaryOrderUnit } from '../../utils/orderUnit.js';
import { CAMERA_PERMISSION_HELP_TEXT, getCameraErrorMessage, logCameraError, startHtml5Scanner, waitForCameraElement } from '../../utils/cameraAccess.js';

function toTaskStatus(value) {
  const text = String(value || '').trim().toLocaleLowerCase('tr-TR');
  if (text === 'completed' || text === 'completade' || text === 'tamamlandi' || text === 'tamamlandı') return 'completed';
  if (text === 'cancelled' || text === 'canceled' || text === 'iptal') return 'cancelled';
  if (text === 'archived' || text === 'arsiv' || text === 'arşiv') return 'archived';
  if (text === 'awaiting_approval' || text === 'awaiting approval' || text === 'onay bekliyor') return 'awaiting_approval';
  if (text === 'in-progress' || text === 'in_progress' || text === 'devam eden') return 'in-progress';
  if (text === 'overdue' || text === 'gecikmis' || text === 'gecikmiş') return 'overdue';
  return 'pending';
}

function formatActivityDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function resolveDepotLocation(product) {
  if (Array.isArray(product?.depotLocations) && product.depotLocations.length > 0) {
    return getDepotDisplayLabel(product.depotLocations[0]?.locationCode);
  }
  return getDepotDisplayLabel(product?.defaultWarehouseLocationCode || product?.warehouseLocationCode || '-');
}

function resolveShelfLocation(product) {
  return String(product?.shelfCode || product?.defaultShelfLocationCode || product?.sectionName || product?.sectionNumber || '-');
}

function resolveShelfCapacity(product) {
  const summary = Number(product?.stockSummary?.shelfCapacity ?? 0);
  const direct = Number(product?.shelfCapacity ?? 0);
  return Math.max(0, summary || direct || 100);
}

function resolveStockBreakdown(product) {
  const summary = product?.stockSummary || {};
  return {
    shelfStock: Number(summary.shelfStock ?? product?.shelfStock ?? 0) || 0,
    warehouseStock: Number(summary.warehouseStock ?? product?.warehouseStock ?? 0) || 0,
  };
}

async function createHtml5Scanner(elementId) {
  const { Html5Qrcode } = await import('html5-qrcode');
  return new Html5Qrcode(elementId);
}

export default function PersonnelMobile() {
  const { user } = useAuth();
  const scannerRef = useRef(null);
  const [isLoading, setIsLoading] = useState(true);
  const [tasks, setTasks] = useState([]);
  const [activities, setActivities] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanError, setScanError] = useState('');
  const { results: searchResults, isSearching } = usePersonnelProductSearch(searchQuery, { limit: 8 });

  useEffect(() => {
    let mounted = true;
    const loadData = async () => {
      setIsLoading(true);
      const [taskRows, activityRows] = await Promise.allSettled([
        taskService.list(),
        user?.id ? userService.listActivities(user.id, { limit: 10 }) : Promise.resolve([]),
      ]);
      if (!mounted) return;
      setTasks(taskRows.status === 'fulfilled' && Array.isArray(taskRows.value) ? taskRows.value : []);
      setActivities(activityRows.status === 'fulfilled' && Array.isArray(activityRows.value) ? activityRows.value : []);
      setIsLoading(false);
    };
    void loadData();
    return () => {
      mounted = false;
    };
  }, [user?.id]);

  const stopScanner = useCallback(async () => {
    const scanner = scannerRef.current;
    if (!scanner) {
      setIsScanning(false);
      return;
    }
    try { await scanner.stop(); } catch {}
    try { await scanner.clear(); } catch {}
    scannerRef.current = null;
    setIsScanning(false);
  }, []);

  const handleScan = useCallback(async () => {
    if (isScanning) {
      await stopScanner();
      return;
    }
    setScanError('');
    setIsScanning(true);
    try {
      await waitForCameraElement('personnel-quick-scan-reader');
      const scanner = await createHtml5Scanner('personnel-quick-scan-reader');
      scannerRef.current = scanner;
      await startHtml5Scanner(
        scanner,
        { fps: 10, qrbox: { width: 240, height: 140 } },
        async (decodedText) => {
          await stopScanner();
          setSearchQuery(decodedText || '');
        },
        () => {}
      );
    } catch (error) {
      logCameraError(error, 'personnel-quick-scan');
      try { await scannerRef.current?.clear(); } catch {}
      setScanError(`${getCameraErrorMessage(error)} ${CAMERA_PERMISSION_HELP_TEXT}`);
      setIsScanning(false);
      scannerRef.current = null;
      return;
    }
  }, [isScanning, stopScanner]);

  useEffect(() => () => { void stopScanner(); }, [stopScanner]);

  const normalizedTasks = useMemo(
    () => tasks.map((task) => ({ ...task, normalizedStatus: toTaskStatus(task.status) })),
    [tasks]
  );
  const actionableTasks = useMemo(
    () => normalizedTasks.filter((task) => ['pending', 'in-progress', 'awaiting_approval'].includes(task.normalizedStatus)),
    [normalizedTasks]
  );

  const kpis = useMemo(() => {
    const now = Date.now();
    const overdueTasks = actionableTasks.filter((task) => {
      const dueDateMs = task.dueDate ? new Date(task.dueDate).getTime() : Number.NaN;
      return Number.isFinite(dueDateMs) && dueDateMs < now;
    });
    const assignedToMe = actionableTasks.filter((task) => task.assignedTo === user?.id);
    return {
      openTasks: actionableTasks.length,
      pendingWork: actionableTasks.length,
      overdueTasks: overdueTasks.length,
      assignedToMe: assignedToMe.length,
    };
  }, [actionableTasks, user?.id]);

  const selectedStock = useMemo(() => resolveStockBreakdown(selectedProduct), [selectedProduct]);
  const selectedShelfCapacity = useMemo(() => resolveShelfCapacity(selectedProduct), [selectedProduct]);
  const selectedRecommendedOrderQty = useMemo(() => {
    const targetStock = Math.floor(Math.max(0, selectedShelfCapacity) * 0.9);
    const needed = Math.max(0, targetStock - selectedStock.shelfStock);
    return Math.max(0, Math.min(needed, selectedStock.warehouseStock));
  }, [selectedShelfCapacity, selectedStock.shelfStock, selectedStock.warehouseStock]);
  const selectedOrderUnit = useMemo(() => getPrimaryOrderUnit(selectedProduct), [selectedProduct]);
  const selectedRecommendedOrderDisplay = useMemo(
    () => formatRecommendedOrderByUnit(selectedProduct, selectedRecommendedOrderQty, selectedOrderUnit),
    [selectedProduct, selectedRecommendedOrderQty, selectedOrderUnit]
  );
  const recentActivities = useMemo(
    () => [...activities]
      .sort((left, right) => new Date(right?.at || 0).getTime() - new Date(left?.at || 0).getTime())
      .slice(0, 5)
      .map((item) => ({
      ...item,
      title: `${item.type || 'İşlem'}${item.reference && item.reference !== '-' ? ` • ${item.reference}` : ''}`,
      subtitle: [item.module, item.detail].filter((value) => value && value !== '-').join(' • ') || 'Aktivite detayı bulunamadı',
      createdAt: item.at,
      })),
    [activities]
  );

  if (isLoading) return <div className="personnel-empty-state">Bilgiler yükleniyor...</div>;

  return (
    <div className="personnel-mobile-home">
      <section className="personnel-kpi-grid">
        <article className="personnel-kpi-card"><div className="kpi-icon blue"><CheckSquare size={20} /></div><div className="kpi-data"><strong>{kpis.openTasks}</strong><span>Açık Görev</span></div></article>
        <article className="personnel-kpi-card"><div className="kpi-icon green"><Briefcase size={20} /></div><div className="kpi-data"><strong>{kpis.pendingWork}</strong><span>Bekleyen İş</span></div></article>
        <article className="personnel-kpi-card"><div className="kpi-icon red"><AlertTriangle size={20} /></div><div className="kpi-data"><strong>{kpis.overdueTasks}</strong><span>Geciken</span></div></article>
        <article className="personnel-kpi-card"><div className="kpi-icon amber"><ClipboardList size={20} /></div><div className="kpi-data"><strong>{kpis.assignedToMe}</strong><span>Bana Atanan</span></div></article>
      </section>

      <section className="personnel-section-card">
        <h2 className="personnel-section-title-emphasized"><Search size={18} className="personnel-title-icon personnel-title-icon-search" /> Hızlı Ara</h2>
        <div className="personnel-search-wrapper" style={{ marginBottom: searchResults.length > 0 ? '12px' : '0' }}>
          <Search size={20} />
          <input className="personnel-input" placeholder="Ürün, SKU, kategori veya tedarikçi ara" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} />
          <button type="button" className="personnel-action-inside" aria-label="Barkod tara" onClick={handleScan}><ScanLine size={20} /></button>
        </div>

        {isScanning && <div style={{ marginTop: '12px', borderRadius: '12px', overflow: 'hidden' }}><div id="personnel-quick-scan-reader"></div></div>}
        {scanError && (
          <div className="personnel-empty-state" style={{ marginTop: '12px', padding: '16px', color: '#ef4444', display: 'grid', gap: '8px', justifyItems: 'center' }}>
            <span>{scanError}</span>
            <button type="button" className="personnel-action-secondary" onClick={handleScan} disabled={isScanning}>
              Tekrar Dene
            </button>
          </div>
        )}

        {isSearching && <span style={{ display: 'block', marginBottom: '8px', fontSize: '0.8rem', color: '#64748b' }}>Aranıyor...</span>}

        {searchResults.length > 0 && (
          <ul className="autocomplete-dropdown" style={{ position: 'relative', top: '0', boxShadow: 'none', border: '1px solid var(--p-border)' }}>
            {searchResults.map((item) => (
              <li key={item.id} onClick={() => { setSelectedProduct(item); setSearchQuery(''); }}>
                <strong>{item.productName}</strong>
                <small>{item.categoryName || 'Kategori Yok'} - SKU: {item.sku || item.barcode}</small>
              </li>
            ))}
          </ul>
        )}

        {selectedProduct && (
          <div style={{ marginTop: '16px', background: '#f8fafc', border: '1px solid var(--p-border)', borderRadius: '12px', padding: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <strong style={{ fontSize: '1rem', color: 'var(--p-ink)' }}>{selectedProduct.productName}</strong>
              <button type="button" className="ghost-button" style={{ minHeight: '32px', padding: '0 8px' }} onClick={() => setSelectedProduct(null)}>
                <X size={18} />
              </button>
            </div>
            <div className="personnel-info-grid" style={{ padding: '0', border: 'none', background: 'transparent' }}>
              <div><span>Depo Stok</span><strong>{selectedStock.warehouseStock} {getProductDisplayUnit(selectedProduct)}</strong></div>
              <div><span>Reyon Stok</span><strong>{selectedStock.shelfStock} {getProductDisplayUnit(selectedProduct)}</strong></div>
              <div><span>Önerilen Sipariş Miktarı</span><strong style={{ color: '#16a34a' }}>{selectedRecommendedOrderDisplay.text}</strong></div>
              <div><span>Fiyat</span><strong>{formatCurrency(getProductDisplayPrice(selectedProduct))}</strong></div>
              <div><span>Depo Konum</span><strong>{resolveDepotLocation(selectedProduct)}</strong></div>
              <div><span>Reyon Konum</span><strong>{resolveShelfLocation(selectedProduct)}</strong></div>
              <div><span>SKU</span><strong>{selectedProduct.sku || '-'}</strong></div>
              <div style={{ gridColumn: '1 / -1' }}><span>Barkod</span><strong>{selectedProduct.barcode || '-'}</strong></div>
            </div>
          </div>
        )}
      </section>

      <section className="personnel-section-card">
        <div className="personnel-section-head">
          <h2 className="personnel-section-title-emphasized"><Activity size={18} className="personnel-title-icon personnel-title-icon-activity" /> Son Aktiviteler</h2>
        </div>
        {recentActivities.length === 0 ? <div className="personnel-empty-state">Bu kullanıcı için son aktivite kaydı bulunmuyor.</div> : (
          <div className="personnel-list">
            {recentActivities.map((item) => (
              <div key={item.id} className="personnel-info-row" style={{ padding: '12px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <strong style={{ fontSize: '0.9rem' }}>{item.title}</strong>
                  <span style={{ fontSize: '0.8rem' }}>{item.subtitle}</span>
                </div>
                <span style={{ fontSize: '0.8rem', color: '#64748b' }}>{formatActivityDate(item.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
