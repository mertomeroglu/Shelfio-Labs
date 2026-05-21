import { useEffect, useMemo, useState } from 'react';
import { Bell, CheckCircle2, ChevronDown, FileSpreadsheet, Gift, Loader2, Search, UsersRound } from 'lucide-react';
import DataTable from '../../components/DataTable.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import FormModal, { FormSection } from '../../components/FormModal.jsx';
import Toast from '../../components/Toast.jsx';
import { customerAdminService } from '../../services/customerAdminService.js';
import { formatCurrency, formatDate } from '../../services/formatters.js';

const loadXlsx = async () => {
  const mod = await import('xlsx');
  return mod.default || mod;
};

const NOTIFICATION_TYPES = [
  { value: 'bilgilendirme', label: 'Bilgilendirme' },
  { value: 'kampanya', label: 'Kampanya' },
      { value: 'uyari', label: 'Uyarı' },
];

const BULK_GIFT_INITIAL = { code: '' };
const NOTIFICATION_INITIAL = { title: '', message: '', type: 'bilgilendirme' };
const CUSTOMER_NAME_ENCODING_FIXES = [
  ['\u00c3\u2013', 'Ö'],
  ['\u00c3\u00bc', 'ü'],
  ['\u00c3\u00b6', 'ö'],
  ['\u00c3\u00a7', 'ç'],
  ['\u00c4\u00b1', 'ı'],
  ['\u00c4\u00b0', 'İ'],
  ['\u00c5\u0178', 'ş'],
  ['\u00c4\u0178', 'ğ'],
  ['\u00c3\u0153', 'Ü'],
  ['\u00c3\u0087', 'Ç'],
  ['\u00c5\u017d', 'Ş'],
  ['\u00c4\u017d', 'Ğ'],
];

function normalizeCustomerName(value) {
  let text = String(value || '');
  CUSTOMER_NAME_ENCODING_FIXES.forEach(([wrong, correct]) => {
    text = text.split(wrong).join(correct);
  });
  return text;
}

function formatGiftCardStatus(card) {
  const rawStatus = String(card?.status || '').trim().toLocaleLowerCase('tr-TR');
  if (card?.isActive === false || rawStatus === 'passive' || rawStatus === 'pasif' || rawStatus === 'paused' || rawStatus === 'inactive') return 'Pasif';
  if (rawStatus === 'active' || rawStatus === 'aktif' || rawStatus === 'assigned') return 'Aktif';
  if (rawStatus === 'used') return 'Kullanıldı';
  return String(card?.status || '').trim() || 'Aktif';
}

function formatGiftCardOptionLabel(card, formatCurrencyFn) {
  const cardValue = card?.valueType === 'percentage' ? `%${Number(card?.value || 0)}` : formatCurrencyFn(Number(card?.value || 0));
  const expiry = card?.expiresAt ? formatDate(card.expiresAt) : 'Süresiz';
  return `${card?.code || '-'} • ${cardValue} • ${formatGiftCardStatus(card)} • ${expiry}`;
}

function formatGiftCardValueText(card, formatCurrencyFn) {
  return card?.valueType === 'percentage'
    ? `%${Number(card?.value || 0)} indirim`
    : formatCurrencyFn(Number(card?.value || 0));
}

function formatGiftCardExpiryText(card) {
  return card?.expiresAt ? formatDate(card.expiresAt) : 'Süresiz';
}

function customerAlreadyHasGiftCard(row, code) {
  const normalizedCode = String(code || '').trim();
  if (!normalizedCode) return false;
  const cards = Array.isArray(row?.giftCards) ? row.giftCards : [];
  return cards.some((card) => String(card?.code || '').trim() === normalizedCode && card?.isValid !== false);
}

function filterCustomersByQuery(rows, query) {
  const normalized = String(query || '').trim().toLocaleLowerCase('tr-TR');
  if (normalized.length < 2) return [];
  return rows.filter((row) => {
    const haystack = [row?.name, row?.phone, row?.email, row?.customerNo]
      .map((value) => String(value || '').toLocaleLowerCase('tr-TR'))
      .join(' ');
    return haystack.includes(normalized);
  });
}

function CustomerTargetSelector({
  rows,
  mode,
  onModeChange,
  selectionIds,
  onToggleCustomer,
  searchTerm,
  onSearchTermChange,
  filteredRows,
  selectedCustomers,
  selectionSummary,
  selectionOverflow,
  targetCount,
  duplicateMessage = null,
}) {
  const hasSearch = String(searchTerm || '').trim().length >= 2;
  const isAllMode = mode === 'all';
  const targetAudienceLabel = isAllMode
    ? 'Tüm müşteri havuzu'
    : selectedCustomers.length
      ? `${selectionSummary}${selectionOverflow > 0 ? ` +${selectionOverflow}` : ''}`
      : 'Henüz müşteri seçilmedi';
  const targetCountLabel = isAllMode ? 'Hedef müşteri sayısı' : 'Seçili müşteri sayısı';

  return (
    <>
      <FormSection title="Hedef Seçimi" className="customer-modal-section customer-notification-target-mode">
        <div className="customer-notification-mode-grid" role="radiogroup" aria-label="Hedef tipi">
          {[
            { value: 'all', label: 'Tüm Müşteriler', helper: `${rows.length} müşteri` },
            { value: 'selected', label: 'Seçili Müşteriler', helper: `${selectionIds.length} müşteri` },
          ].map((option) => (
            <button
              key={option.value}
              type="button"
              className={`customer-notification-mode-card ${mode === option.value ? 'is-active' : ''}`}
              onClick={() => onModeChange(option.value)}
              aria-pressed={mode === option.value}
            >
              <strong>{option.label}</strong>
              <span>{option.helper}</span>
            </button>
          ))}
        </div>
      </FormSection>

      <FormSection title="Hedef Özeti" className="customer-modal-section customer-notification-target">
        <div className="customer-meta-grid customer-meta-grid-2">
          <div><small>{targetCountLabel}</small><strong>{targetCount}</strong></div>
          <div className="customer-meta-email">
            <small>Hedef kitle</small>
            <strong>{targetAudienceLabel}</strong>
          </div>
        </div>
      </FormSection>

      {isAllMode ? (
        <FormSection
          title="Müşteri Seçimi"
          description="Bu modda hedef kitle tüm müşteri havuzu olarak alınır; ek müşteri seçimi gerekmez."
          className="customer-modal-section"
        >
          <div className="customer-gift-selection-summary customer-gift-selection-summary-all">
            <span>{rows.length} müşterinin tamamına işlem uygulanacak</span>
            {duplicateMessage ? <span>{duplicateMessage}</span> : null}
          </div>
        </FormSection>
      ) : (
        <FormSection title="Müşteri Seçimi" description="En az 2 karakterle arayın ve hedef kitlenizi belirleyin." className="customer-modal-section">
          <div className="customer-gift-selection-toolbar">
            <div className="customer-gift-selection-toolbar-main">
              <label className="customer-list-search-field customer-gift-selection-search">
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(event) => onSearchTermChange(event.target.value)}
                  placeholder="Müşteri adı, telefon, e-posta veya müşteri no ara"
                />
              </label>
              <small className="customer-gift-selection-helper">Sonuçları görmek için en az 2 karakter girin.</small>
            </div>
          </div>

          <div className="customer-gift-selection-summary">
            <span>{selectionIds.length} müşteri seçildi</span>
            {hasSearch ? <span>{filteredRows.length} sonuç filtreye dahil</span> : null}
            {duplicateMessage ? <span>{duplicateMessage}</span> : null}
          </div>

          <div className="customer-gift-selection-list">
            {hasSearch && filteredRows.length ? filteredRows.map((row) => {
              const isSelected = selectionIds.includes(String(row.id));
              return (
                <label key={row.id} className={`customer-gift-selection-item ${isSelected ? 'is-selected' : ''}`}>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={(event) => onToggleCustomer(row.id, event.target.checked)}
                  />
                  <div className="customer-gift-selection-item-body">
                    <strong>{row.name || '-'}</strong>
                    <span>{row.customerNo || '-'} • {row.phone || '-'} • {row.email || '-'}</span>
                  </div>
                  {isSelected ? <CheckCircle2 size={16} aria-hidden="true" /> : null}
                </label>
              );
            }) : (
              hasSearch ? <div className="customer-empty-state-card customer-gift-selection-empty-state">
                <p>Bu filtreye uygun müşteri bulunamadı.</p>
              </div> : null
            )}
          </div>
        </FormSection>
      )}
    </>
  );
}

export default function CustomerManagement() {
  const [rows, setRows] = useState([]);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showAllOrders, setShowAllOrders] = useState(false);

  const [isNotificationModalOpen, setNotificationModalOpen] = useState(false);
  const [notificationMode, setNotificationMode] = useState('selected');
  const [notificationSelectionIds, setNotificationSelectionIds] = useState([]);
  const [notificationSearchTerm, setNotificationSearchTerm] = useState('');
  const [notificationDraft, setNotificationDraft] = useState(NOTIFICATION_INITIAL);
  const [sendingNotification, setSendingNotification] = useState(false);

  const [isBulkGiftModalOpen, setBulkGiftModalOpen] = useState(false);
  const [bulkGiftMode, setBulkGiftMode] = useState('selected');
  const [bulkGiftDraft, setBulkGiftDraft] = useState(BULK_GIFT_INITIAL);
  const [bulkGiftLoading, setBulkGiftLoading] = useState(false);
  const [availableGiftCards, setAvailableGiftCards] = useState([]);
  const [availableGiftCardsLoading, setAvailableGiftCardsLoading] = useState(false);
  const [bulkGiftSelectionIds, setBulkGiftSelectionIds] = useState([]);
  const [bulkGiftSearchTerm, setBulkGiftSearchTerm] = useState('');
  const [bulkGiftCardSearchTerm, setBulkGiftCardSearchTerm] = useState('');
  const [isBulkGiftCardDropdownOpen, setIsBulkGiftCardDropdownOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const list = await customerAdminService.list();
      setRows((Array.isArray(list) ? list : []).map((item) => ({ ...item, name: normalizeCustomerName(item?.name) })));
    } catch (error) {
      setToast({ type: 'error', title: 'Müşteri', message: error.message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    document.title = 'Müşteri Yönetimi | Shelfio';
  }, []);

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    setDetail(null);
    customerAdminService
      .detail(selected.id)
      .then((next) => setDetail({
        ...next,
        customer: next?.customer ? { ...next.customer, name: normalizeCustomerName(next.customer.name) } : next?.customer,
      }))
      .catch((error) => setToast({ type: 'error', title: 'Müşteri', message: error.message }));
  }, [selected]);

  useEffect(() => {
    if (!isBulkGiftModalOpen) return;

    let active = true;
    setAvailableGiftCardsLoading(true);
    customerAdminService
      .listAvailableGiftCards()
      .then((rows) => {
        if (!active) return;
        setAvailableGiftCards(Array.isArray(rows) ? rows : []);
      })
      .catch((error) => {
        if (!active) return;
        setToast({ type: 'error', title: 'Hediye Kartı', message: error.message || 'Hediye kartları yüklenemedi.' });
      })
      .finally(() => {
        if (active) setAvailableGiftCardsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [isBulkGiftModalOpen]);

  const closeNotificationModal = () => {
    if (sendingNotification) return;
    setNotificationModalOpen(false);
    setNotificationMode('selected');
    setNotificationSelectionIds([]);
    setNotificationSearchTerm('');
    setNotificationDraft(NOTIFICATION_INITIAL);
  };

  const closeBulkGiftModal = () => {
    if (bulkGiftLoading) return;
    setBulkGiftModalOpen(false);
    setBulkGiftMode('selected');
    setBulkGiftDraft(BULK_GIFT_INITIAL);
    setAvailableGiftCards([]);
    setBulkGiftSelectionIds([]);
    setBulkGiftSearchTerm('');
    setBulkGiftCardSearchTerm('');
    setIsBulkGiftCardDropdownOpen(false);
  };

  const openBulkGiftModal = () => {
    setBulkGiftMode(selectedIds.length ? 'selected' : 'all');
    setBulkGiftSelectionIds(selectedIds.map((id) => String(id)));
    setBulkGiftSearchTerm('');
    setBulkGiftCardSearchTerm('');
    setIsBulkGiftCardDropdownOpen(false);
    setBulkGiftModalOpen(true);
  };

  const openNotificationModal = () => {
    setNotificationMode(selectedIds.length ? 'selected' : 'all');
    setNotificationSelectionIds(selectedIds.map((id) => String(id)));
    setNotificationSearchTerm('');
    setNotificationModalOpen(true);
  };

  const columns = useMemo(
    () => [
      {
        key: 'select',
        label: '',
        sortable: false,
        className: 'customer-cell-select',
        render: (row) => (
          <input
            type="checkbox"
            checked={selectedIds.includes(row.id)}
            onChange={(event) => {
              event.stopPropagation();
              setSelectedIds((current) =>
                current.includes(row.id) ? current.filter((id) => id !== row.id) : [...current, row.id]
              );
            }}
          />
        ),
      },
      { key: 'customerNo', label: 'Müşteri No' },
      { key: 'name', label: 'Ad Soyad' },
      { key: 'phone', label: 'Telefon' },
      { key: 'email', label: 'E-posta' },
      { key: 'createdAt', label: 'Kayıt Tarihi', render: (row) => formatDate(row.createdAt) },
      { key: 'totalOrders', label: 'Toplam Sipariş' },
      { key: 'totalSpent', label: 'Toplam Harcama', render: (row) => formatCurrency(Number(row.totalSpent || 0)) },
      {
        key: 'actions',
        label: 'İşlemler',
        sortable: false,
        className: 'customer-cell-actions',
        render: (row) => (
          <button
            className="ghost-button"
            type="button"
            onClick={() => {
              setSelected(row);
              setShowAllOrders(false);
            }}
          >
            Detay
          </button>
        ),
      },
    ],
    [selectedIds]
  );

  const filteredRows = useMemo(() => {
    const q = String(searchTerm || '').trim().toLocaleLowerCase('tr-TR');
    if (!q) return rows;
    return rows.filter((row) => {
      const name = String(row?.name || '').toLocaleLowerCase('tr-TR');
      const phone = String(row?.phone || '').toLocaleLowerCase('tr-TR');
      const email = String(row?.email || '').toLocaleLowerCase('tr-TR');
      const no = String(row?.customerNo || '').toLocaleLowerCase('tr-TR');
      return name.includes(q) || phone.includes(q) || email.includes(q) || no.includes(q);
    });
  }, [rows, searchTerm]);

  const exportToExcel = async () => {
    const XLSX = await loadXlsx();
    const selectedSet = new Set(selectedIds);
    const exportRows = selectedSet.size ? rows.filter((row) => selectedSet.has(row.id)) : rows;
    const data = exportRows.map((row) => ({
      'Müşteri No': row?.customerNo || '-',
      'Ad Soyad': normalizeCustomerName(row?.name) || '-',
      Telefon: row?.phone || '-',
      'E-posta': row?.email || '-',
      'Kayıt Tarihi': formatDate(row?.createdAt),
      'Toplam Sipariş': row?.totalOrders ?? 0,
      'Toplam Harcama': Number(row?.totalSpent || 0),
    }));
    const sheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, 'Müşteriler');
    XLSX.writeFile(workbook, 'shelfio-musteriler.xlsx');
  };

  const sendNotification = async () => {
    const title = String(notificationDraft.title || '').trim();
    const message = String(notificationDraft.message || '').trim();
    if (!title || !message) {
      setToast({ type: 'error', title: 'Bildirim', message: 'Başlık ve mesaj zorunludur.' });
      return;
    }

    try {
      setSendingNotification(true);
      const payload = { mode: notificationMode, title, message, type: notificationDraft.type };
      if (notificationMode === 'selected') payload.customerIds = effectiveNotificationSelectionIds;

      if (notificationMode === 'selected' && !payload.customerIds?.length) {
        setToast({ type: 'error', title: 'Bildirim', message: 'Lütfen en az bir müşteri seçin.' });
        return;
      }

      const result = await customerAdminService.sendNotification(payload);
      setToast({ type: 'success', title: 'Bildirim', message: `${result.sentCount || 0} müşteriye bildirim gönderildi.` });
      closeNotificationModal();
    } catch (error) {
      setToast({ type: 'error', title: 'Bildirim', message: error.message });
    } finally {
      setSendingNotification(false);
    }
  };

  const handleAssignGiftCardBulk = async () => {
    const code = String(bulkGiftDraft.code || '').trim();
    const customerIds = bulkGiftAssignableSelectionIds.filter(Boolean);
    if (!effectiveBulkGiftSelectionIds.length) {
      setToast({
        type: 'error',
        title: 'Hediye Kartı',
        message: bulkGiftMode === 'all' ? 'Atama yapılacak müşteri bulunamadı.' : 'Lütfen en az bir müşteri seçin.',
      });
      return;
    }
    if (!code) {
      setToast({ type: 'error', title: 'Hediye Kartı', message: 'Hediye kartı kodu zorunludur.' });
      return;
    }
    if (!customerIds.length) {
      setToast({ type: 'warning', title: 'Hediye Kartı', message: 'Seçili müşterilerin tamamında bu hediye kartı zaten bulunuyor.' });
      return;
    }

    try {
      setBulkGiftLoading(true);
      const result = await customerAdminService.assignGiftCardBulk({ customerIds, code });
      const assigned = Number(result?.assignedCount || 0);
      const skipped = Number(result?.skippedCount || 0) + bulkGiftDuplicateSelectionIds.length;
      setToast({
        type: skipped > 0 ? 'warning' : 'success',
        title: 'Hediye Kartı',
        message: skipped > 0 ? `${assigned} müşteriye atandı, ${skipped} müşteri atlandı.` : `${assigned} müşteriye hediye kartı atandı.`,
      });
      setSelectedIds(customerIds);
      await load();
      if (selected?.id && customerIds.includes(String(selected.id))) {
        const refreshed = await customerAdminService.detail(selected.id);
        setDetail({
          ...refreshed,
          customer: refreshed?.customer ? { ...refreshed.customer, name: normalizeCustomerName(refreshed.customer.name) } : refreshed?.customer,
        });
      }
      closeBulkGiftModal();
    } catch (error) {
      setToast({ type: 'error', title: 'Hediye Kartı', message: error.message });
    } finally {
      setBulkGiftLoading(false);
    }
  };

  const allOrders = Array.isArray(detail?.orders) ? detail.orders : [];
  const recentOrders = Array.isArray(detail?.lastOrders) && detail.lastOrders.length ? detail.lastOrders.slice(0, 5) : allOrders.slice(0, 5);
  const ordersToRender = showAllOrders ? allOrders : recentOrders;
  const assignedGiftCards = Array.isArray(detail?.customer?.giftCards) ?
    detail.customer.giftCards.filter((card) => card?.isValid !== false)
    : [];
  const selectableBulkGiftCards = useMemo(
    () => availableGiftCards.filter((card) => {
      const status = String(card?.status || '').toLocaleLowerCase('tr-TR');
      const usageLimit = Number(card?.usageLimit ?? card?.maxUsage ?? 1);
      const remainingUsageSource = Number(card?.remainingUsage);
      const remainingUsage = Number.isFinite(remainingUsageSource)
        ? Math.max(0, Math.min(Number.isFinite(usageLimit) && usageLimit > 0 ? usageLimit : remainingUsageSource, remainingUsageSource))
        : (Number.isFinite(usageLimit) && usageLimit > 0 ? Math.max(0, usageLimit - Number(card?.usedCount || 0)) : 0);
      return card?.isActive !== false && status !== 'used' && status !== 'pasif' && remainingUsage > 0 && card?.isAssignable !== false;
    }),
    [availableGiftCards]
  );
  const selectedBulkGiftCard = useMemo(
    () => selectableBulkGiftCards.find((card) => card.code === bulkGiftDraft.code) || null,
    [bulkGiftDraft.code, selectableBulkGiftCards]
  );
  useEffect(() => {
    if (!isBulkGiftModalOpen || !selectedBulkGiftCard) return;
    setBulkGiftCardSearchTerm((current) => current || formatGiftCardOptionLabel(selectedBulkGiftCard, formatCurrency));
  }, [isBulkGiftModalOpen, selectedBulkGiftCard]);
  useEffect(() => {
    if (!isBulkGiftModalOpen || !isBulkGiftCardDropdownOpen) return undefined;
    const handlePointerDown = (event) => {
      const comboRoot = event.target instanceof Element ? event.target.closest('.customer-gift-card-combobox') : null;
      if (!comboRoot) setIsBulkGiftCardDropdownOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [isBulkGiftCardDropdownOpen, isBulkGiftModalOpen]);
  const bulkGiftCardQuery = String(bulkGiftCardSearchTerm || '').trim().toLocaleLowerCase('tr-TR');
  const filteredSelectableBulkGiftCards = useMemo(() => {
    if (!bulkGiftCardQuery) return selectableBulkGiftCards;
    return selectableBulkGiftCards.filter((card) => formatGiftCardOptionLabel(card, formatCurrency).toLocaleLowerCase('tr-TR').includes(bulkGiftCardQuery));
  }, [bulkGiftCardQuery, selectableBulkGiftCards]);
  const bulkGiftCardFieldValue = useMemo(() => {
    if (bulkGiftCardSearchTerm) return bulkGiftCardSearchTerm;
    if (!selectedBulkGiftCard) return '';
    return `${selectedBulkGiftCard.code || '-'} · ${formatGiftCardValueText(selectedBulkGiftCard, formatCurrency)}`;
  }, [bulkGiftCardSearchTerm, selectedBulkGiftCard]);
  const customersById = useMemo(
    () => new Map(rows.map((row) => [String(row.id), row])),
    [rows]
  );
  const allCustomerIds = useMemo(
    () => rows.map((row) => String(row.id || '')).filter(Boolean),
    [rows]
  );
  const effectiveNotificationSelectionIds = useMemo(
    () => (notificationMode === 'all' ? allCustomerIds : notificationSelectionIds),
    [allCustomerIds, notificationMode, notificationSelectionIds]
  );
  const effectiveBulkGiftSelectionIds = useMemo(
    () => (bulkGiftMode === 'all' ? allCustomerIds : bulkGiftSelectionIds),
    [allCustomerIds, bulkGiftMode, bulkGiftSelectionIds]
  );
  const bulkGiftNormalizedSearchTerm = String(bulkGiftSearchTerm || '').trim();
  const bulkGiftFilteredRows = useMemo(() => {
    return filterCustomersByQuery(rows, bulkGiftNormalizedSearchTerm);
  }, [bulkGiftNormalizedSearchTerm, rows]);
  const selectedBulkGiftCustomers = useMemo(
    () => effectiveBulkGiftSelectionIds.map((id) => customersById.get(String(id))).filter(Boolean),
    [customersById, effectiveBulkGiftSelectionIds]
  );
  const selectedBulkGiftSummaryNames = selectedBulkGiftCustomers.slice(0, 3).map((row) => row.name).filter(Boolean);
  const bulkGiftSelectionSummary = selectedBulkGiftSummaryNames.join(', ');
  const bulkGiftSelectionOverflow = selectedBulkGiftCustomers.length - selectedBulkGiftSummaryNames.length;
  const bulkGiftDuplicateSelectionIds = useMemo(() => {
    if (!bulkGiftDraft.code) return [];
    return effectiveBulkGiftSelectionIds.filter((id) => customerAlreadyHasGiftCard(customersById.get(String(id)), bulkGiftDraft.code));
  }, [bulkGiftDraft.code, customersById, effectiveBulkGiftSelectionIds]);
  const bulkGiftAssignableSelectionIds = useMemo(
    () => effectiveBulkGiftSelectionIds.filter((id) => !bulkGiftDuplicateSelectionIds.includes(id)),
    [bulkGiftDuplicateSelectionIds, effectiveBulkGiftSelectionIds]
  );
  const closeDetailModal = () => {
    setSelected(null);
    setDetail(null);
    setShowAllOrders(false);
  };
  const canSendNotification = Boolean(String(notificationDraft.title || '').trim() && String(notificationDraft.message || '').trim());
  const canAssignSelectedGiftCard = Boolean(bulkGiftDraft.code && bulkGiftAssignableSelectionIds.length > 0);
  const notificationFilteredRows = useMemo(
    () => filterCustomersByQuery(rows, notificationSearchTerm),
    [notificationSearchTerm, rows]
  );
  const selectedNotificationCustomers = useMemo(
    () => effectiveNotificationSelectionIds.map((id) => customersById.get(String(id))).filter(Boolean),
    [customersById, effectiveNotificationSelectionIds]
  );
  const selectedNotificationSummaryNames = selectedNotificationCustomers.slice(0, 3).map((row) => row.name).filter(Boolean);
  const notificationSelectionSummary = selectedNotificationSummaryNames.join(', ');
  const notificationSelectionOverflow = selectedNotificationCustomers.length - selectedNotificationSummaryNames.length;
  const toggleNotificationCustomer = (customerId, checked) => {
    const safeId = String(customerId || '').trim();
    if (!safeId) return;
    setNotificationSelectionIds((current) => {
      if (checked) return current.includes(safeId) ? current : [...current, safeId];
      return current.filter((id) => id !== safeId);
    });
  };

  const toggleBulkGiftCustomer = (customerId, checked) => {
    const safeId = String(customerId || '').trim();
    if (!safeId) return;
    setBulkGiftSelectionIds((current) => {
      if (checked) return current.includes(safeId) ? current : [...current, safeId];
      return current.filter((id) => id !== safeId);
    });
  };

  const handleBulkGiftCardInputChange = (value) => {
    setBulkGiftCardSearchTerm(value);
    setIsBulkGiftCardDropdownOpen(true);
    const normalizedValue = String(value || '').trim();
    const matchingCard = selectableBulkGiftCards.find((card) => String(card?.code || '').trim().toLocaleLowerCase('tr-TR') === normalizedValue.toLocaleLowerCase('tr-TR'));
    setBulkGiftDraft({ code: matchingCard?.code || '' });
  };

  const handleBulkGiftCardSelect = (card) => {
    setBulkGiftDraft({ code: card?.code || '' });
    setBulkGiftCardSearchTerm(card ? `${card.code || '-'} · ${formatGiftCardValueText(card, formatCurrency)}` : '');
    setIsBulkGiftCardDropdownOpen(false);
  };

  return (
    <div className="users-page customer-management-page">
      <PageHeader
        title="Müşteri Yönetimi"
        description="Müşterileri, siparişlerini, indirim ve hediye kartlarını yönetin."
        icon={<UsersRound size={18} />}
      />

      <div className="customer-management-toolbar">
        <button className="primary-button customer-toolbar-button" type="button" onClick={openNotificationModal}>
          <Bell size={16} /> Bildirim Gönder
        </button>
        <button className="primary-button customer-toolbar-button" type="button" onClick={openBulkGiftModal}>
          <Gift size={16} /> Hediye Kartı Ata
        </button>
        <button className="primary-button customer-toolbar-button" type="button" onClick={exportToExcel} disabled={!rows.length}>
          <FileSpreadsheet size={16} /> Excel Dışa Aktar
        </button>
      </div>

      <div className="mod-card customer-table-card">
        <div className="mod-card-header">
          <div className="mod-card-icon mod-icon-blue"><UsersRound size={18} /></div>
          <div><h3 className="mod-card-title">Müşteri Listesi</h3><p className="mod-card-desc">Tüm müşterileri görüntüleyin ve yönetin</p></div>
          <div className="customer-list-search">
            <label className="customer-list-search-field">
              <Search size={14} />
              <input
                type="text"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Müşteri adı, telefon veya e-posta ara"
              />
            </label>
          </div>
        </div>
        <DataTable columns={columns} rows={filteredRows} isLoading={loading} emptyMessage="Müşteri bulunmuyor" pageSize={10} />
      </div>

      <FormModal
        isOpen={Boolean(selected)}
        title="Müşteri Detayı"
        description="Müşteri bilgisi, harcama özeti ve sipariş geçmişini görüntüleyin."
        headerIcon={<UsersRound size={16} />}
        onClose={closeDetailModal}
        modalClassName="customer-detail-modal customer-modal-standard"
        confirmOnDirtyClose={false}
      >
        <div className="modal-form modal-structured-form customer-detail-form">
          <div className="modal-form-body-scroll customer-detail-body">
            <div className="customer-detail-summary-grid">
              <FormSection title="Müşteri Bilgileri" className="customer-modal-section">
                <div className="customer-meta-grid customer-meta-grid-2">
                  <div><small>Ad Soyad</small><strong>{detail?.customer?.name || '-'}</strong></div>
                  <div><small>Telefon</small><strong>{detail?.customer?.phone || '-'}</strong></div>
                  <div><small>Müşteri No</small><strong>{detail?.customer?.customerNo || '-'}</strong></div>
                  <div><small>Kayıt Tarihi</small><strong>{formatDate(detail?.customer?.createdAt)}</strong></div>
                  <div className="customer-meta-email"><small>E-posta</small><strong>{detail?.customer?.email || '-'}</strong></div>
                </div>
              </FormSection>

              <FormSection title="Harcama Özeti" className="customer-modal-section">
                <div className="customer-meta-grid customer-meta-grid-2 customer-stats-grid">
                  <div><small>Toplam Harcama</small><strong>{formatCurrency(Number(detail?.summary?.totalSpent || 0))}</strong></div>
                  <div><small>Ortalama Sipariş</small><strong>{formatCurrency(Number(detail?.summary?.averageOrderAmount || 0))}</strong></div>
                  <div><small>Toplam Sipariş</small><strong>{detail?.summary?.totalOrders ?? detail?.customer?.totalOrders ?? 0}</strong></div>
                  <div><small>Son Sipariş Tarihi</small><strong>{formatDate(detail?.summary?.lastOrderAt)}</strong></div>
                </div>
              </FormSection>
            </div>

            <FormSection title="Sipariş Geçmişi" className="customer-modal-section">
              <div className="customer-detail-orders-head">
                {allOrders.length > 5 ? (
                  <button className="ghost-button" type="button" onClick={() => setShowAllOrders((current) => !current)}>
                    {showAllOrders ? 'Son 5 siparişi göster' : 'Tüm siparişleri göster'}
                  </button>
                ) : null}
              </div>
              {!ordersToRender.length ? (
                <div className="customer-empty-state-card">
                  <p>Bu müşteriye ait sipariş geçmişi bulunmuyor.</p>
                </div>
              ) : (
                <ul className="customer-order-list customer-order-list-structured">
                  {ordersToRender.map((order) => (
                    <li key={order.id} className="customer-order-item">
                      <span><small>Sipariş No</small><strong>{order.orderNo || order.id || '-'}</strong></span>
                      <span><small>Tarih</small><strong>{formatDate(order.createdAt)}</strong></span>
                      <span><small>Tutar</small><strong>{formatCurrency(Number(order.totalAmount || 0))}</strong></span>
                      <span><small>Durum</small><strong>{order.status || '-'}</strong></span>
                    </li>
                  ))}
                </ul>
              )}
            </FormSection>

            <FormSection title="Hediye Kartı Bilgisi" className="customer-modal-section customer-gift-card-section">
              {assignedGiftCards.length > 0 ? (
                <ul className="customer-order-list customer-gift-card-list customer-order-list-structured">
                  {assignedGiftCards.map((card) => (
                    <li key={card.id || card.code} className="customer-order-item">
                      <span><small>Kart Kodu</small><strong>{card.code || '-'}</strong></span>
                      <span><small>Değer</small><strong>{card.valueType === 'percentage' ? `%${Number(card.value || 0)}` : formatCurrency(Number(card.value || 0))}</strong></span>
                      <span><small>Durum</small><strong>{formatGiftCardStatus(card)}</strong></span>
                      <span><small>Son Kullanım</small><strong>{card.expiresAt ? formatDate(card.expiresAt) : 'Süresiz'}</strong></span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="customer-empty-state-card">
                  <p>Bu müşteriye atanmış hediye kartı bulunmuyor.</p>
                </div>
              )}
            </FormSection>
          </div>

          <div className="modal-actions modal-actions-sticky customer-detail-footer">
            <button className="ghost-button" type="button" onClick={closeDetailModal}>
              Kapat
            </button>
          </div>
        </div>
      </FormModal>

      <FormModal
        isOpen={isNotificationModalOpen}
        title="Bildirim Gönder"
        description="Seçilen hedef kitleye bildirim gönderin."
        headerIcon={<Bell size={16} />}
        onClose={closeNotificationModal}
        modalClassName="customer-notification-modal customer-modal-standard customer-modal-notification"
        confirmOnDirtyClose={false}
      >
        <div className="modal-form modal-structured-form customer-notification-form">
          <div className="modal-form-body-scroll customer-notification-body">
            <CustomerTargetSelector
              rows={rows}
              mode={notificationMode}
              onModeChange={setNotificationMode}
              selectionIds={notificationSelectionIds}
              onToggleCustomer={toggleNotificationCustomer}
              searchTerm={notificationSearchTerm}
              onSearchTermChange={setNotificationSearchTerm}
              filteredRows={notificationFilteredRows}
              selectedCustomers={selectedNotificationCustomers}
              selectionSummary={notificationSelectionSummary}
              selectionOverflow={notificationSelectionOverflow}
              targetCount={effectiveNotificationSelectionIds.length}
            />

            <FormSection title="Bildirim İçeriği" className="customer-modal-section">
              <label className="customer-form-field">
                <span>Başlık</span>
                <input value={notificationDraft.title} onChange={(event) => setNotificationDraft((current) => ({ ...current, title: event.target.value }))} placeholder="Bildirim başlığı" />
              </label>
              <label className="customer-form-field">
                <span>Mesaj</span>
                <textarea rows={4} value={notificationDraft.message} onChange={(event) => setNotificationDraft((current) => ({ ...current, message: event.target.value }))} placeholder="Bildirim metni" />
              </label>
              <label className="customer-form-field">
                <span>Bildirim Tipi</span>
                <select value={notificationDraft.type} onChange={(event) => setNotificationDraft((current) => ({ ...current, type: event.target.value }))}>
                  {NOTIFICATION_TYPES.map((item) => (
                    <option key={item.value} value={item.value}>{item.label}</option>
                  ))}
                </select>
              </label>
            </FormSection>
          </div>

          <div className="modal-actions modal-actions-sticky customer-notification-footer">
            <button className="ghost-button" type="button" onClick={closeNotificationModal} disabled={sendingNotification}>İptal</button>
            <button className="primary-button" type="button" onClick={sendNotification} disabled={sendingNotification || !canSendNotification}>
              {sendingNotification ? <Loader2 size={14} className="spin" /> : null}
              {sendingNotification ? 'Gönderiliyor...' : 'Gönder'}
            </button>
          </div>
        </div>
      </FormModal>

      <FormModal
        isOpen={isBulkGiftModalOpen}
        title="Hediye Kartı Ata"
        description="Tekil veya çoklu müşteri seçip mevcut bir hediye kartı atayın."
        headerIcon={<Gift size={16} />}
        onClose={closeBulkGiftModal}
        modalClassName="customer-notification-modal customer-modal-standard customer-modal-gift-assign"
        confirmOnDirtyClose={false}
      >
        <div className="modal-form modal-structured-form customer-notification-form">
            <div className="modal-form-body-scroll customer-notification-body">
              <CustomerTargetSelector
              rows={rows}
              mode={bulkGiftMode}
              onModeChange={setBulkGiftMode}
              selectionIds={bulkGiftSelectionIds}
              onToggleCustomer={toggleBulkGiftCustomer}
              searchTerm={bulkGiftSearchTerm}
              onSearchTermChange={setBulkGiftSearchTerm}
              filteredRows={bulkGiftFilteredRows}
                selectedCustomers={selectedBulkGiftCustomers}
                selectionSummary={bulkGiftSelectionSummary}
                selectionOverflow={bulkGiftSelectionOverflow}
                targetCount={effectiveBulkGiftSelectionIds.length}
                duplicateMessage={bulkGiftDuplicateSelectionIds.length ? `${bulkGiftDuplicateSelectionIds.length} müşteri bu karta zaten sahip, tekrar atanmayacak.` : null}
              />

              <FormSection title="Hediye Kartı Seçimi" description="Sadece aktif ve atanabilir hediye kartları listelenir." className="customer-modal-section">
                {availableGiftCardsLoading ? (
                  <div className="customer-empty-state-card">
                  <p>Atanabilir hediye kartları yükleniyor...</p>
                </div>
              ) : selectableBulkGiftCards.length ? (
                <div className="customer-form-field customer-gift-card-combobox">
                  <span>Hediye Kartı Seç</span>
                  <div className="customer-gift-card-combobox-field">
                    <input
                      type="text"
                      value={bulkGiftCardFieldValue}
                      onChange={(event) => handleBulkGiftCardInputChange(event.target.value)}
                      onFocus={() => setIsBulkGiftCardDropdownOpen(true)}
                      placeholder="Kart kodu veya değer ara"
                      autoComplete="off"
                      role="combobox"
                      aria-expanded={isBulkGiftCardDropdownOpen}
                      aria-controls="bulk-gift-card-listbox"
                    />
                    <button
                      type="button"
                      className="customer-gift-card-combobox-trigger"
                      onClick={() => setIsBulkGiftCardDropdownOpen((current) => !current)}
                      aria-label="Hediye kartı listesini aç"
                    >
                      <ChevronDown size={16} aria-hidden="true" />
                    </button>
                  </div>
                  {isBulkGiftCardDropdownOpen ? (
                    <div className="customer-gift-card-combobox-popover" role="presentation">
                      <div className="customer-gift-card-combobox-head" aria-hidden="true">
                        <span>Kart kodu</span>
                        <span>Değer</span>
                        <span>Durum</span>
                        <span>Son kullanım</span>
                      </div>
                      <div className="customer-gift-card-combobox-list" role="listbox" id="bulk-gift-card-listbox" aria-label="Atanabilir hediye kartları">
                        {filteredSelectableBulkGiftCards.length ? filteredSelectableBulkGiftCards.map((card) => (
                          <button
                            key={card.id || card.code}
                            type="button"
                            className={`customer-gift-card-combobox-option ${bulkGiftDraft.code === card.code ? 'is-selected' : ''}`}
                            onClick={() => handleBulkGiftCardSelect(card)}
                            role="option"
                            aria-selected={bulkGiftDraft.code === card.code}
                          >
                            <strong>{card.code || '-'}</strong>
                            <span>{formatGiftCardValueText(card, formatCurrency)}</span>
                            <span>Aktif</span>
                            <span>{formatGiftCardExpiryText(card)}</span>
                          </button>
                        )) : <span className="customer-gift-card-combobox-empty">Eşleşen hediye kartı bulunamadı.</span>}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="customer-empty-state-card">
                    <p>Atanabilir hediye kartı bulunamadı. Aktif hediye kartları burada listelenir.</p>
                </div>
              )}
            </FormSection>
            {selectedBulkGiftCard ? (
              <FormSection title="Seçilen Kart Bilgisi" className="customer-modal-section customer-gift-card-selection-summary">
                <div className="customer-meta-grid customer-meta-grid-2">
                  <div><small>Kart Kodu</small><strong>{selectedBulkGiftCard.code || '-'}</strong></div>
                  <div><small>Değer</small><strong>{selectedBulkGiftCard.valueType === 'percentage' ? `%${Number(selectedBulkGiftCard.value || 0)}` : formatCurrency(Number(selectedBulkGiftCard.value || 0))}</strong></div>
                  <div><small>Durum</small><strong>{formatGiftCardStatus(selectedBulkGiftCard)}</strong></div>
                  <div><small>Son Kullanım Tarihi</small><strong>{selectedBulkGiftCard.expiresAt ? formatDate(selectedBulkGiftCard.expiresAt) : 'Süresiz'}</strong></div>
                </div>
              </FormSection>
            ) : null}
            </div>
            <div className="modal-actions modal-actions-sticky customer-notification-footer">
              <button className="ghost-button" type="button" onClick={closeBulkGiftModal} disabled={bulkGiftLoading}>İptal</button>
              <button className="primary-button" type="button" onClick={handleAssignGiftCardBulk} disabled={bulkGiftLoading || !canAssignSelectedGiftCard}>
                {bulkGiftLoading ? <Loader2 size={14} className="spin" /> : null}
                {bulkGiftLoading ? 'Atanıyor...' : 'Ata'}
              </button>
          </div>
        </div>
      </FormModal>

      {toast ? <Toast toast={toast} onClose={() => setToast(null)} /> : null}
    </div>
  );
}
