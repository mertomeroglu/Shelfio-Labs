import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, Info, Search, X, ShieldAlert } from 'lucide-react';
import { notificationEvents, notificationService } from '../../services/notificationService.js';

function formatRelative(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / (60 * 1000));
  if (minutes < 1) return 'Az önce';
  if (minutes < 60) return `${minutes} dk önce`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} sa önce`;
  return `${Math.floor(hours / 24)} gün önce`;
}

function toPriorityKey(value) {
  const text = String(value || '').trim().toLocaleLowerCase('tr-TR');
  if (text === 'high' || text === 'yuksek' || text === 'yüksek' || text === 'kritik') return 'high';
  if (text === 'medium' || text === 'orta' || text === 'uyari' || text === 'uyarı') return 'medium';
  return 'low';
}

function toTypeLabel(value) {
  const text = String(value || '').trim();
  if (!text) return 'Bilgi';
  if (/critical|kritik|error|hata|danger/i.test(text)) return 'Kritik';
  if (/warning|uyari|uyarı/i.test(text)) return 'Uyarı';
  return 'Bilgi';
}

function isPersonnelNotification(item) {
  const actionType = String(item?.actionType || '').toLowerCase();
  const type = String(item?.type || '').toLowerCase();
  const title = String(item?.title || '').toLowerCase();
  const actionUrl = String(item?.actionUrl || '').toLowerCase();
  if (item?.relatedTaskId) return true;
  if (actionUrl.startsWith('/personel') || actionUrl.includes('/gorev') || actionUrl.includes('/siparis')) return true;
  if (actionType === 'task' || actionType === 'order' || actionType === 'stock') return true;
  if (/(task|gorev|siparis|stok|sla|assigned|overdue|upcoming|mention|comment)/.test(type)) return true;
  return /(task|gorev|siparis|stok|sla|assigned|overdue|upcoming|mention|comment)/.test(title);
}

export default function PersonnelNotifications() {
  const [notifications, setNotifications] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [markingId, setMarkingId] = useState('');
  const [detailItem, setDetailItem] = useState(null);

  const loadNotifications = useCallback(async () => {
    setIsLoading(true);
    try {
      const list = await notificationService.list({ limit: 120 });
      const rows = Array.isArray(list) ? list.filter(isPersonnelNotification) : [];
      setNotifications(rows);
    } catch {
      setNotifications([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadNotifications();
  }, [loadNotifications]);

  useEffect(() => {
    const handleChanged = () => {
      void loadNotifications();
    };
    window.addEventListener(notificationEvents.changed, handleChanged);
    return () => window.removeEventListener(notificationEvents.changed, handleChanged);
  }, [loadNotifications]);

  const handleMarkRead = async (id) => {
    if (!id || markingId) return;
    setMarkingId(id);
    try {
      await notificationService.markAsRead(id);
      setNotifications((current) => current.map((item) => (item.id === id ? { ...item, isRead: true } : item)));
    } finally {
      setMarkingId('');
    }
  };

  const filteredNotifications = useMemo(
    () =>
      notifications.filter((item) => {
        if (filter === 'unread' && item.isRead) return false;
        if (filter === 'critical' && toPriorityKey(item.priority) !== 'high') return false;
        if (searchQuery.trim()) {
          const sq = searchQuery.trim().toLowerCase();
          const title = String(item.title || '').toLowerCase();
          const description = String(item.description || '').toLowerCase();
          if (!title.includes(sq) && !description.includes(sq)) return false;
        }
        return true;
      }),
    [notifications, filter, searchQuery]
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div className="personnel-search-wrapper">
          <Search size={20} />
          <input className="personnel-input" placeholder="Bildirim ara..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
        </div>
        <select className="personnel-select" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">Tümü</option>
          <option value="unread">Okunmamış</option>
          <option value="critical">Kritik</option>
        </select>
      </div>

      {isLoading ? <div className="personnel-empty-state">Bildirimler yükleniyor...</div> : null}
      {!isLoading && filteredNotifications.length === 0 ? (
        <div className="personnel-empty-state">Eşleşen bildirim bulunamadı.</div>
      ) : null}

      {!isLoading && filteredNotifications.length > 0 ? (
        <ul className="personnel-list" style={{ padding: 0, margin: 0, listStyle: 'none' }}>
          {filteredNotifications.map((item, index) => {
            const stateText = String(item.status || item.state || '').toLowerCase();
            const isResolved = item.isRead || /(resolved|completed|done|processed|tamam|islen)/.test(stateText);
            const isCriticalOpen = !isResolved && (toPriorityKey(item.priority) === 'high' || /(open|delayed|late|critical|acik|gecik)/.test(stateText));
            const priorityKey = toPriorityKey(item.priority);
            const typeLabel = toTypeLabel(item.type || item.actionType);

            return (
              <li key={item.id || `notif-${index}`} className={`personnel-list-card ${isResolved ? 'theme-green' : isCriticalOpen ? 'theme-red' : 'theme-amber'}`}>
                <div className="personnel-list-card-header">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0 }}>
                    <div className="personnel-traffic-lights" aria-hidden="true">
                      <span className={priorityKey === 'low' ? 'active green' : 'green'} />
                      <span className={priorityKey === 'medium' ? 'active amber' : 'amber'} />
                      <span className={priorityKey === 'high' ? 'active red' : 'red'} />
                    </div>
                    <h3 className="personnel-list-card-title">{item.title || 'Bildirim'}</h3>
                    <div className="personnel-list-card-meta">{formatRelative(item.createdAt)} • {typeLabel}</div>
                  </div>
                </div>

                <p className="personnel-list-card-body">{item.description || '-'}</p>

                <div className="personnel-list-card-actions">
                  <button type="button" className="secondary-button" aria-label="Bildirim detayı" onClick={() => setDetailItem(item)}>
                    <Info size={16} /> Detay
                  </button>
                  <button type="button" className={item.isRead ? 'ghost-button' : 'primary-button'} onClick={() => handleMarkRead(item.id)} disabled={item.isRead || markingId === item.id}>
                    {item.isRead ? 'Okundu' : markingId === item.id ? 'İşleniyor...' : 'Okundu İşaretle'}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {detailItem ? (
        <div className="personnel-modal-overlay" role="dialog" aria-modal="true" aria-label="Bildirim detayı">
          <div className="personnel-modal-card">
            <header className="personnel-modal-header">
              <div className="personnel-modal-header-main">
                <span className="personnel-modal-header-icon" aria-hidden="true">
                  {toPriorityKey(detailItem.priority) === 'high' ? <ShieldAlert size={18} color="var(--p-accent)" /> : <Bell size={18} color="var(--p-accent)" />}
                </span>
                <div className="personnel-modal-header-copy">
                  <h3>Bildirim Detayı</h3>
                  <p>{detailItem.title || 'Bildirim'}</p>
                </div>
              </div>
              <button type="button" className="personnel-modal-close" onClick={() => setDetailItem(null)} aria-label="Kapat">
                <X size={20} />
              </button>
            </header>

            <div className="personnel-modal-body">
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '16px' }}>
                <span style={{ display: 'block', fontSize: '0.8rem', color: '#64748b', fontWeight: 600, marginBottom: '6px' }}>Mesaj</span>
                <p style={{ margin: 0, fontSize: '0.9rem', color: '#334155', lineHeight: 1.5 }}>{detailItem.description || '-'}</p>
              </div>

              <div className="personnel-info-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
                <div><span>Durum</span><strong>{detailItem.isRead ? 'Okundu' : 'Okunmadı'}</strong></div>
                <div><span>Zaman</span><strong>{formatRelative(detailItem.createdAt)}</strong></div>
                <div><span>Önem Derecesi</span><strong>{toPriorityKey(detailItem.priority) === 'high' ? 'Kritik' : toPriorityKey(detailItem.priority) === 'medium' ? 'Uyarı' : 'Bilgi'}</strong></div>
                <div><span>Kaynak Modül</span><strong>{({ task: 'Görev', order: 'Sipariş', stock: 'Stok', notification: 'Bildirim', purchase: 'Satın Alma', customer: 'Müşteri', system: 'Sistem' }[String(detailItem.source || detailItem.actionType || '').trim().toLowerCase()] || String(detailItem.source || detailItem.actionType || '-'))}</strong></div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

