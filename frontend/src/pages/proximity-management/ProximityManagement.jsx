import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  BellRing,
  ChevronRight,
  ClipboardList,
  MapPinned,
  Plus,
  RadioTower,
  RefreshCw,
  Save,
  X,
} from 'lucide-react';
import PageHeader from '../../components/PageHeader.jsx';
import { proximityAdminService } from '../../services/proximityAdminService.js';
import { eslService } from '../../services/eslService.js';
import { sectionService } from '../../services/sectionService.js';
import { isRequestCancellation } from '../../services/api.js';
import './ProximityManagement.css';

const TABS = [
  { id: 'summary', label: 'Özet', icon: Activity },
  { id: 'beacons', label: 'Beacon Cihazları', icon: RadioTower },
  { id: 'zones', label: 'Zone Eşleştirme', icon: MapPinned },
  { id: 'rules', label: 'Bildirim Kuralları', icon: BellRing },
  { id: 'events', label: 'Event Logları', icon: ClipboardList },
  { id: 'deliveries', label: 'Teslimat / Cooldown', icon: RefreshCw },
];

const BEACON_STATUSES = ['ACTIVE', 'PASSIVE', 'MAINTENANCE'];
const ZONE_TYPES = ['ENTRANCE', 'AISLE', 'SHELF', 'CHECKOUT', 'WAREHOUSE', 'SECTION'];
const TARGET_TYPES = ['customer'];
const TRIGGERS = ['ZONE_ENTER', 'DWELL'];
const ACTION_TYPES = ['route', 'campaign', 'none'];
const EVENT_TYPES = ['ZONE_ENTER', 'DWELL', 'ZONE_EXIT'];
const SOURCES = ['WEBVIEW_BRIDGE', 'ANDROID_NATIVE', 'ANDROID_BLE'];
const DELIVERY_STATUSES = ['SHOWN', 'SKIPPED', 'CLICKED', 'DISMISSED', 'FAILED'];
const PM_PAGE_SIZE = 10;
const BEACON_STATUS_OPTIONS = [
  { value: 'ACTIVE', label: 'Aktif' },
  { value: 'PASSIVE', label: 'Pasif' },
  { value: 'MAINTENANCE', label: 'Bakımda' },
];
const ZONE_TYPE_OPTIONS = [
  { value: 'AISLE', label: 'Reyon Alanı' },
  { value: 'ENTRANCE', label: 'Giriş Alanı' },
  { value: 'SHELF', label: 'Kampanya Alanı' },
  { value: 'CHECKOUT', label: 'Kasa Yakını' },
  { value: 'SECTION', label: 'Genel Alan' },
  { value: 'WAREHOUSE', label: 'Depo Alanı' },
];
const TARGET_TYPE_OPTIONS = [
  { value: 'customer', label: 'Müşteri' },
];
const TRIGGER_OPTIONS = [
  { value: 'ZONE_ENTER', label: 'Alana girişte' },
  { value: 'DWELL', label: 'Alanda belirli süre kalınca' },
];
const ACTION_TYPE_OPTIONS = [
  { value: 'route', label: 'Uygulama sayfası' },
  { value: 'campaign', label: 'Kampanya' },
  { value: 'none', label: 'Butonsuz bildirim' },
];
const MODAL_DESCRIPTIONS = {
  beacon: 'Mağaza içinde müşteri yaklaştığında algılanacak beacon cihazını tanımlayın.',
  zone: 'Müşterinin yakınında bulunduğu alanı tanımlayın.',
  rule: 'Müşteri belirli bir alana geldiğinde gösterilecek bildirimi ayarlayın.',
};
const REASON_LABELS = {
  PRODUCT_DISCOUNT_ALREADY_NOTIFIED_12H: 'Bu ürün için yakın zamanda bildirim gönderildi',
  NO_ACTIVE_DISCOUNT_FOR_LABEL_PRODUCT: 'Etiketteki üründe aktif indirim yok',
  NO_LINKED_ESL_DEVICE: 'Beacon elektronik etiketle eşleşmemiş',
  NO_LABEL_PRODUCT: 'Etikette ürün bilgisi yok',
  UNKNOWN_BEACON: 'Beacon eşleşmedi',
  NOT_AUTHENTICATED: 'Müşteri oturumu yok / geçersiz',
  CUSTOMER_ONLY_FEATURE: 'Sadece müşteri uygulaması için',
  INVALID_EVENT_TYPE: 'Event tipi geçersiz',
  NO_MATCHING_ZONE: 'Zone eşleşmesi bulunamadı',
};

const empty = (value) => {
  if (value === null || value === undefined || value === '') return '-';
  return value;
};

const formatReason = (value) => {
  const code = String(value || '').trim();
  if (!code) return '-';
  return REASON_LABELS[code] || code;
};

const formatDate = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('tr-TR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
};

const toRows = (value) => (Array.isArray(value) ? value : []);
const metaOf = (value) => value?.meta || {};

const parseJsonField = (value, fallback = {}) => {
  const text = String(value || '').trim();
  if (!text) return fallback;
  return JSON.parse(text);
};

const stringifyJson = (value) => {
  if (!value || typeof value !== 'object') return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '';
  }
};

const formatRuleCooldown = (rule = {}) => {
  const payload = rule?.payload && typeof rule.payload === 'object' ? rule.payload : {};
  const seconds = Number(payload.cooldownSeconds ?? payload.testCooldownSeconds);
  if (Number.isFinite(seconds) && seconds >= 1) return `${seconds} sn`;
  return `${rule.cooldownMinutes ?? 30} dk`;
};

const nextFrame = () => new Promise((resolve) => {
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
    setTimeout(resolve, 0);
    return;
  }
  window.requestAnimationFrame(() => resolve());
});

const blurActiveElement = () => {
  if (typeof document === 'undefined') return;
  const activeElement = document.activeElement;
  if (activeElement && typeof activeElement.blur === 'function') {
    activeElement.blur();
  }
};

const friendlyRequestMessage = (error, fallback) => {
  if (isRequestCancellation(error)) return '';
  if (error?.status === 401) return 'Oturum süreniz doldu. Lütfen tekrar giriş yapın.';
  if (error?.status === 403) return 'Bu işlem için yetkiniz bulunmuyor.';
  return error?.message || fallback;
};

function SelectField({ label, value, onChange, options, placeholder = 'Seçiniz', required = false, help = '', error = '', wide = false }) {
  const selectName = String(label || 'select')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'select';
  const normalizedOptions = Array.isArray(options) ? options : [];
  const optionValues = new Set(normalizedOptions.map((option) => String(typeof option === 'string' ? option : option.value ?? '')));
  const rawValue = value ?? '';
  const safeValue = rawValue === '' || optionValues.has(String(rawValue)) ? rawValue : '';
  return (
    <label className={`pm-field ${wide ? 'pm-field-wide' : ''} ${error ? 'pm-field-invalid' : ''}`}>
      <span>{label}{required ? ' *' : ''}</span>
      <select name={selectName} value={safeValue} onChange={(event) => onChange(event.target.value)}>
        <option key={`${selectName}-placeholder`} value="">{placeholder}</option>
        {normalizedOptions.map((option, index) => {
          const optionValue = typeof option === 'string' ? option : option.value;
          const optionLabel = typeof option === 'string' ? option : option.label;
          return (
            <option key={`${selectName}-${optionValue || 'empty'}-${index}`} value={optionValue || ''}>
              {optionLabel}
            </option>
          );
        })}
      </select>
      {help ? <small>{help}</small> : null}
      {error ? <strong className="pm-inline-error">{error}</strong> : null}
    </label>
  );
}

function TextField({ label, value, onChange, type = 'text', required = false, placeholder = '', help = '', error = '', wide = false, suffix = '' }) {
  return (
    <label className={`pm-field ${wide ? 'pm-field-wide' : ''} ${error ? 'pm-field-invalid' : ''}`}>
      <span>{label}{required ? ' *' : ''}</span>
      <span className={suffix ? 'pm-input-with-suffix' : ''}>
        <input type={type} value={value ?? ''} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
        {suffix ? <em>{suffix}</em> : null}
      </span>
      {help ? <small>{help}</small> : null}
      {error ? <strong className="pm-inline-error">{error}</strong> : null}
    </label>
  );
}

function TextAreaField({ label, value, onChange, rows = 3, placeholder = '', help = '', error = '', wide = true }) {
  return (
    <label className={`pm-field ${wide ? 'pm-field-wide' : ''} ${error ? 'pm-field-invalid' : ''}`}>
      <span>{label}</span>
      <textarea rows={rows} value={value ?? ''} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
      {help ? <small>{help}</small> : null}
      {error ? <strong className="pm-inline-error">{error}</strong> : null}
    </label>
  );
}

function ToggleField({ label, checked, onChange, help = '', wide = false }) {
  return (
    <label className={`pm-toggle-field ${wide ? 'pm-field-wide' : ''}`}>
      <input type="checkbox" checked={Boolean(checked)} onChange={(event) => onChange(event.target.checked)} />
      <span>
        {label}
        {help ? <small>{help}</small> : null}
      </span>
    </label>
  );
}

function FormSection({ title, children }) {
  return (
    <section className="pm-form-section">
      <h4>{title}</h4>
      <div className="pm-form-grid">{children}</div>
    </section>
  );
}

function AdvancedSection({ children }) {
  return (
    <details className="pm-advanced-section">
      <summary>Gelişmiş Ayarlar</summary>
      <div className="pm-form-grid">{children}</div>
    </details>
  );
}

function usePagedRows(rows) {
  const [page, setPage] = useState(1);
  const total = Array.isArray(rows) ? rows.length : 0;
  const totalPages = Math.max(1, Math.ceil(total / PM_PAGE_SIZE));

  useEffect(() => {
    setPage((current) => Math.min(current, totalPages));
  }, [totalPages]);

  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * PM_PAGE_SIZE;
  const pagedRows = useMemo(
    () => (Array.isArray(rows) ? rows.slice(startIndex, startIndex + PM_PAGE_SIZE) : []),
    [rows, startIndex],
  );

  return {
    rows: pagedRows,
    page: safePage,
    total,
    totalPages,
    start: total ? startIndex + 1 : 0,
    end: total ? Math.min(startIndex + PM_PAGE_SIZE, total) : 0,
    setPage,
  };
}

export default function ProximityManagement() {
  const mountedRef = useRef(false);
  const [activeTab, setActiveTab] = useState('summary');
  const [beacons, setBeacons] = useState([]);
  const [zones, setZones] = useState([]);
  const [rules, setRules] = useState([]);
  const [events, setEvents] = useState([]);
  const [deliveries, setDeliveries] = useState([]);
  const [sections, setSections] = useState([]);
  const [eslDevices, setEslDevices] = useState([]);
  const [eventFilters, setEventFilters] = useState({ limit: 30 });
  const [deliveryFilters, setDeliveryFilters] = useState({ limit: 30 });
  const [loading, setLoading] = useState(true);
  const [logLoading, setLogLoading] = useState(false);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState({});
  const [formError, setFormError] = useState('');
  const [formErrors, setFormErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const sectionOptions = useMemo(
    () => sections.map((section) => ({ value: section.id, label: section.name || section.title || section.code || section.id })),
    [sections]
  );
  const zoneOptions = useMemo(
    () => zones.map((zone) => ({
      value: zone.id,
      label: `${zone.name || zone.code || zone.id}${zone.code ? ` (${zone.code})` : ''}`,
      sectionId: zone.sectionId || '',
    })),
    [zones]
  );
  const beaconOptions = useMemo(
    () => beacons.map((beacon) => ({ value: beacon.id, label: `${beacon.name || beacon.deviceCode || beacon.id}${beacon.deviceCode ? ` (${beacon.deviceCode})` : ''}` })),
    [beacons]
  );
  const eslDeviceOptions = useMemo(
    () => eslDevices.map((device) => ({ value: device.id, label: `${device.name || device.id}${device.id ? ` (${device.id})` : ''}` })),
    [eslDevices]
  );

  const loadBaseData = useCallback(async () => {
    if (!mountedRef.current) return;
    setLoading(true);
    setError('');
    const results = await Promise.allSettled([
      proximityAdminService.getBeacons({ limit: 100 }),
      proximityAdminService.getZones({ limit: 100 }),
      proximityAdminService.getRules({ limit: 100 }),
      sectionService.list({ forceRefresh: true }),
      eslService.listDevices(),
    ]);

    if (!mountedRef.current) return;
    const [beaconResult, zoneResult, ruleResult, sectionResult, eslDeviceResult] = results;
    if (beaconResult.status === 'fulfilled') setBeacons(toRows(beaconResult.value));
    if (zoneResult.status === 'fulfilled') setZones(toRows(zoneResult.value));
    if (ruleResult.status === 'fulfilled') setRules(toRows(ruleResult.value));
    if (sectionResult.status === 'fulfilled') setSections(toRows(sectionResult.value));
    if (eslDeviceResult.status === 'fulfilled') setEslDevices(toRows(eslDeviceResult.value));

    const firstError = results.find((result) => result.status === 'rejected' && !isRequestCancellation(result.reason));
    if (firstError) {
      setError(friendlyRequestMessage(firstError.reason, 'Proximity yönetimi verileri alınamadı.'));
    }
    setLoading(false);
  }, []);

  const loadLogs = useCallback(async () => {
    if (!mountedRef.current) return;
    setLogLoading(true);
    const results = await Promise.allSettled([
      proximityAdminService.getEvents(eventFilters),
      proximityAdminService.getDeliveries(deliveryFilters),
    ]);

    if (!mountedRef.current) return;
    const [eventResult, deliveryResult] = results;
    if (eventResult.status === 'fulfilled') setEvents(toRows(eventResult.value));
    if (deliveryResult.status === 'fulfilled') setDeliveries(toRows(deliveryResult.value));

    const firstError = results.find((result) => result.status === 'rejected' && !isRequestCancellation(result.reason));
    if (firstError) {
      setError(friendlyRequestMessage(firstError.reason, 'Loglar alınamadı.'));
    }
    setLogLoading(false);
  }, [deliveryFilters, eventFilters]);

  useEffect(() => {
    mountedRef.current = true;
    loadBaseData();
    return () => {
      mountedRef.current = false;
    };
  }, [loadBaseData]);

  useEffect(() => {
    if (activeTab === 'events' || activeTab === 'deliveries' || activeTab === 'summary') {
      loadLogs();
    }
  }, [activeTab]);

  const closeModal = useCallback(() => {
    blurActiveElement();
    setFormError('');
    setFormErrors({});
    setModal(null);
  }, []);

  const updateForm = (key, value) => {
    setFormErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
    setForm((current) => ({ ...current, [key]: value }));
  };

  const openBeaconModal = (beacon = null) => {
    setFormError('');
    setFormErrors({});
    setModal({ type: 'beacon', id: beacon?.id || null });
    setForm({
      name: beacon?.name || '',
      deviceCode: beacon?.deviceCode || '',
      uuid: beacon?.uuid || '',
      major: beacon?.major ?? '',
      minor: beacon?.minor ?? '',
      locationZoneId: beacon?.locationZoneId || '',
      sectionId: beacon?.sectionId || '',
      status: beacon?.status || 'ACTIVE',
      firmwareVersion: beacon?.firmwareVersion || '',
      eslDeviceId: beacon?.metadata?.eslDeviceId || beacon?.eslDeviceId || beacon?.linkedEslDeviceId || '',
      originalEslDeviceId: beacon?.metadata?.eslDeviceId || beacon?.eslDeviceId || beacon?.linkedEslDeviceId || '',
      clearEslDeviceLink: false,
      metadata: stringifyJson(beacon?.metadata),
    });
  };

  const openZoneModal = (zone = null) => {
    setFormError('');
    setFormErrors({});
    setModal({ type: 'zone', id: zone?.id || null });
    setForm({
      name: zone?.name || '',
      code: zone?.code || '',
      type: zone?.type || 'AISLE',
      sectionId: zone?.sectionId || '',
      description: zone?.description || '',
      isActive: zone?.isActive ?? true,
      metadata: stringifyJson(zone?.metadata),
    });
  };

  const openRuleModal = (rule = null) => {
    setFormError('');
    setFormErrors({});
    setModal({ type: 'rule', id: rule?.id || null });
    setForm({
      name: rule?.name || '',
      targetType: 'customer',
      trigger: rule?.trigger || 'ZONE_ENTER',
      locationZoneId: rule?.locationZoneId || '',
      beaconDeviceId: rule?.beaconDeviceId || '',
      title: rule?.title || '',
      message: rule?.message || '',
      actionType: rule?.actionType || 'route',
      actionUrl: rule?.actionUrl || '',
      actionLabel: rule?.payload?.actionLabel || '',
      cooldownMinutes: rule?.cooldownMinutes ?? 30,
      maxPerVisit: rule?.maxPerVisit ?? '',
      priority: rule?.priority ?? 0,
      isActive: rule?.isActive ?? true,
      payload: stringifyJson(rule?.payload),
    });
  };

  const validateModalForm = () => {
    const nextErrors = {};
    if (modal.type === 'beacon') {
      if (!String(form.name || '').trim()) nextErrors.name = 'Lütfen cihaz adını girin.';
      if (!String(form.deviceCode || '').trim()) nextErrors.deviceCode = 'Lütfen cihaz kodunu girin.';
      if (!form.status) nextErrors.status = 'Lütfen cihaz durumunu seçin.';
    }
    if (modal.type === 'zone') {
      if (!String(form.name || '').trim()) nextErrors.name = 'Lütfen alan adını girin.';
      if (!String(form.code || '').trim()) nextErrors.code = 'Lütfen alan kodunu girin.';
      if (!form.type) nextErrors.type = 'Lütfen alan tipini seçin.';
    }
    if (modal.type === 'rule') {
      if (!String(form.name || '').trim()) nextErrors.name = 'Lütfen kural adını girin.';
      if (!form.targetType) nextErrors.targetType = 'Lütfen bildirimin kime gösterileceğini seçin.';
      if (!form.trigger) nextErrors.trigger = 'Lütfen bildirimin ne zaman çıkacağını seçin.';
      if (!String(form.title || '').trim()) nextErrors.title = 'Lütfen bildirim başlığını girin.';
      if (!String(form.message || '').trim()) nextErrors.message = 'Lütfen bildirim mesajını girin.';
      if (Number(form.cooldownMinutes) <= 0) nextErrors.cooldownMinutes = 'Lütfen tekrar süresini 1 dakikadan büyük girin.';
      if (form.actionUrl && !String(form.actionUrl).startsWith('/musteri')) {
        nextErrors.actionUrl = 'Müşteri sayfası linki /musteri ile başlamalıdır.';
      }
    }
    setFormErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const submitModal = async (event) => {
    event.preventDefault();
    if (!modal) return;

    setSaving(true);
    setFormError('');
    setFormErrors({});
    try {
      if (!validateModalForm()) {
        setFormError('Lütfen işaretli alanları kontrol edin.');
        return;
      }
      if (modal.type === 'beacon') {
        if (!String(form.deviceCode || '').trim()) throw new Error('Lütfen cihaz kodunu girin.');
        const metadata = parseJsonField(form.metadata, {});
        const payload = {
          ...form,
          major: form.major === '' ? null : Number(form.major),
          minor: form.minor === '' ? null : Number(form.minor),
          locationZoneId: form.locationZoneId || null,
          sectionId: form.sectionId || null,
          metadata: {
            ...metadata,
            ...(form.eslDeviceId ? { eslDeviceId: form.eslDeviceId } : {}),
          },
        };
        if (form.eslDeviceId) {
          payload.eslDeviceId = form.eslDeviceId;
        } else if (form.clearEslDeviceLink === true) {
          payload.eslDeviceId = null;
          delete payload.metadata.eslDeviceId;
        } else if (form.originalEslDeviceId) {
          payload.metadata.eslDeviceId = form.originalEslDeviceId;
        } else {
          delete payload.metadata.eslDeviceId;
        }
        delete payload.originalEslDeviceId;
        delete payload.clearEslDeviceLink;
        delete payload.metadataText;
        if (modal.id) await proximityAdminService.updateBeacon(modal.id, payload);
        else await proximityAdminService.createBeacon(payload);
      }

      if (modal.type === 'zone') {
        if (!String(form.name || '').trim()) throw new Error('Lütfen alan adını girin.');
        if (!String(form.code || '').trim()) throw new Error('Lütfen alan kodunu girin.');
        const payload = {
          ...form,
          sectionId: form.sectionId || null,
          metadata: parseJsonField(form.metadata, null),
        };
        if (modal.id) await proximityAdminService.updateZone(modal.id, payload);
        else await proximityAdminService.createZone(payload);
      }

      if (modal.type === 'rule') {
        if (!form.targetType) throw new Error('Lütfen bildirimin kime gösterileceğini seçin.');
        if (!form.trigger) throw new Error('Lütfen bildirimin ne zaman çıkacağını seçin.');
        if (!String(form.title || '').trim() || !String(form.message || '').trim()) {
          throw new Error('Lütfen bildirim başlığı ve mesajını girin.');
        }
        if (Number(form.cooldownMinutes) <= 0) throw new Error('Lütfen tekrar bekleme süresini 1 dakikadan büyük girin.');
        if (form.actionUrl && form.targetType === 'customer' && !String(form.actionUrl).startsWith('/musteri')) {
          throw new Error('Müşteri sayfası linki /musteri ile başlamalıdır.');
        }
        if (form.actionUrl && !String(form.actionUrl).startsWith('/musteri')) {
          throw new Error('Müşteri sayfası linki /musteri ile başlamalıdır.');
        }
        const payloadJson = parseJsonField(form.payload, {});
        const payload = {
          ...form,
          locationZoneId: form.locationZoneId || null,
          beaconDeviceId: form.beaconDeviceId || null,
          cooldownMinutes: Number(form.cooldownMinutes),
          maxPerVisit: form.maxPerVisit === '' ? null : Number(form.maxPerVisit),
          priority: Number(form.priority || 0),
          payload: form.actionLabel ? { ...payloadJson, actionLabel: form.actionLabel } : payloadJson,
        };
        delete payload.actionLabel;
        if (modal.id) await proximityAdminService.updateRule(modal.id, payload);
        else await proximityAdminService.createRule(payload);
      }

      closeModal();
      await nextFrame();
      await loadBaseData();
      if (activeTab === 'events' || activeTab === 'deliveries' || activeTab === 'summary') {
        await loadLogs();
      }
    } catch (err) {
      if (err instanceof SyntaxError) {
        setFormError('JSON alanını kontrol edin. Örnek: {"not": "kısa açıklama"}');
      } else {
        setFormError(err?.message || 'Kayıt işlemi tamamlanamadı.');
      }
    } finally {
      setSaving(false);
    }
  };

  const toggleBeaconStatus = async (beacon) => {
    const nextStatus = beacon.status === 'ACTIVE' ? 'PASSIVE' : 'ACTIVE';
    await proximityAdminService.updateBeaconStatus(beacon.id, nextStatus);
    await loadBaseData();
  };

  const toggleRuleStatus = async (rule) => {
    await proximityAdminService.updateRuleStatus(rule.id, !rule.isActive);
    await loadBaseData();
  };

  const renderToolbarAction = () => {
    if (activeTab === 'beacons') {
      return <button className="pm-primary-button" type="button" onClick={() => openBeaconModal()}><Plus size={16} /> Yeni Beacon</button>;
    }
    if (activeTab === 'zones') {
      return <button className="pm-primary-button" type="button" onClick={() => openZoneModal()}><Plus size={16} /> Yeni Yakınlık Alanı</button>;
    }
    if (activeTab === 'rules') {
      return <button className="pm-primary-button" type="button" onClick={() => openRuleModal()}><Plus size={16} /> Yeni Bildirim Kuralı</button>;
    }
    return <button className="pm-secondary-button" type="button" onClick={() => { loadBaseData(); loadLogs(); }}><RefreshCw size={16} /> Yenile</button>;
  };

  return (
    <div className="proximity-management-page">
      <PageHeader
        icon={<RadioTower size={22} />}
        title="Proximity Yönetimi"
        description="ESP/BLE beacon cihazları, zone eşleşmeleri, bildirim kuralları ve yakınlık logları."
        actions={renderToolbarAction()}
      />

      <div className="pm-divider" />

      <div className="pm-tabs" role="tablist" aria-label="Proximity yönetimi sekmeleri">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              className={`pm-tab ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <Icon size={16} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {error ? <div className="pm-alert">{error}</div> : null}
      {loading ? <div className="pm-loading">Proximity yönetimi verileri yükleniyor...</div> : null}

      {!loading && activeTab === 'summary' ? (
        <SummaryTab beacons={beacons} zones={zones} rules={rules} events={events} deliveries={deliveries} onTabChange={setActiveTab} />
      ) : null}

      {!loading && activeTab === 'beacons' ? (
        <BeaconTab rows={beacons} onEdit={openBeaconModal} onToggleStatus={toggleBeaconStatus} onShowLogs={(beacon) => {
          setEventFilters((current) => ({ ...current, beaconDeviceId: beacon.id }));
          setActiveTab('events');
        }} />
      ) : null}

      {!loading && activeTab === 'zones' ? (
        <ZoneTab rows={zones} onEdit={openZoneModal} />
      ) : null}

      {!loading && activeTab === 'rules' ? (
        <RuleTab rows={rules} onEdit={openRuleModal} onToggleStatus={toggleRuleStatus} />
      ) : null}

      {!loading && activeTab === 'events' ? (
        <EventLogTab
          rows={events}
          filters={eventFilters}
          setFilters={setEventFilters}
          onRefresh={loadLogs}
          loading={logLoading}
          beacons={beaconOptions}
          zones={zoneOptions}
        />
      ) : null}

      {!loading && activeTab === 'deliveries' ? (
        <DeliveryLogTab
          rows={deliveries}
          filters={deliveryFilters}
          setFilters={setDeliveryFilters}
          onRefresh={loadLogs}
          loading={logLoading}
          beacons={beaconOptions}
          zones={zoneOptions}
        />
      ) : null}

      {modal ? (
        <Modal key={`${modal.type}-${modal.id || 'new'}`} title={modalTitle(modal)} description={MODAL_DESCRIPTIONS[modal.type]} type={modal.type} onClose={closeModal} onSubmit={submitModal} saving={saving} error={formError}>
          {modal.type === 'beacon' ? (
            <BeaconForm form={form} errors={formErrors} updateForm={updateForm} zoneOptions={zoneOptions} sectionOptions={sectionOptions} eslDeviceOptions={eslDeviceOptions} />
          ) : null}
          {modal.type === 'zone' ? (
            <ZoneForm form={form} errors={formErrors} updateForm={updateForm} sectionOptions={sectionOptions} />
          ) : null}
          {modal.type === 'rule' ? (
            <RuleForm form={form} errors={formErrors} updateForm={updateForm} zoneOptions={zoneOptions} beaconOptions={beaconOptions} />
          ) : null}
        </Modal>
      ) : null}
    </div>
  );
}

function SummaryTab({ beacons, zones, rules, events, deliveries, onTabChange }) {
  const activeBeacons = beacons.filter((item) => item.status === 'ACTIVE').length;
  const activeRules = rules.filter((item) => item.isActive).length;
  const skippedDeliveries = deliveries.filter((item) => item.status === 'SKIPPED').length;
  const cards = [
    { label: 'Aktif beacon', value: activeBeacons, hint: `${beacons.length} cihaz kayıtlı`, tab: 'beacons', icon: RadioTower, tone: 'blue' },
    { label: 'Aktif zone', value: zones.filter((item) => item.isActive !== false).length, hint: `${zones.length} zone tanımlı`, tab: 'zones', icon: MapPinned, tone: 'green' },
    { label: 'Aktif kural', value: activeRules, hint: `${rules.length} kural kayıtlı`, tab: 'rules', icon: BellRing, tone: 'amber' },
    { label: 'Son event', value: events.length, hint: 'Sayfalı log görünümü', tab: 'events', icon: ClipboardList, tone: 'indigo' },
    { label: 'Cooldown skip', value: skippedDeliveries, hint: 'Teslimat loglarında', tab: 'deliveries', icon: RefreshCw, tone: 'rose' },
  ];

  return (
    <div className="pm-summary-grid">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <button key={card.label} type="button" className={`pm-summary-card pm-summary-card--${card.tone}`} onClick={() => onTabChange(card.tab)}>
            <span className="pm-summary-icon" aria-hidden="true"><Icon size={18} /></span>
            <span className="pm-summary-label">{card.label}</span>
            <strong>{card.value}</strong>
            <small>{card.hint}</small>
            <ChevronRight className="pm-summary-arrow" size={16} />
          </button>
        );
      })}
    </div>
  );
}
function BeaconTab({ rows, onEdit, onToggleStatus, onShowLogs }) {
  const pagination = usePagedRows(rows);
  return (
    <TableShell emptyText="Henüz beacon cihazı eklenmemiş." pagination={pagination}>
      <thead>
        <tr>
          <th>Cihaz adı</th>
          <th>Device ID / Code</th>
          <th>UUID</th>
          <th>Major</th>
          <th>Minor</th>
          <th>Bağlı ESL</th>
          <th>Eşleşen Zone</th>
          <th>Eşleşen Reyon</th>
          <th>Durum</th>
          <th>Son Görülme</th>
          <th>Pil</th>
          <th>Firmware</th>
          <th className="pm-actions-cell">Aksiyonlar</th>
        </tr>
      </thead>
      <tbody>
        {pagination.rows.map((row) => (
          <tr key={row.id}>
            <td>{empty(row.name)}</td>
            <td>{empty(row.deviceCode)}</td>
            <td className="pm-mono">{empty(row.uuid)}</td>
            <td>{empty(row.major)}</td>
            <td>{empty(row.minor)}</td>
            <td>{empty(row.linkedEslDevice?.name || row.linkedEslDevice?.id || row.metadata?.eslDeviceId)}</td>
            <td>{empty(row.locationZone?.name || row.locationZoneId)}</td>
            <td>{empty(row.section?.name || row.sectionId)}</td>
            <td><StatusPill value={row.status} /></td>
            <td>{formatDate(row.lastSeenAt)}</td>
            <td>{row.batteryLevel === null || row.batteryLevel === undefined ? '-' : `%${row.batteryLevel}`}</td>
            <td>{empty(row.firmwareVersion)}</td>
            <td className="pm-actions-cell">
              <button type="button" onClick={() => onEdit(row)}>Düzenle</button>
              <button type="button" onClick={() => onToggleStatus(row)}>{row.status === 'ACTIVE' ? 'Pasifleştir' : 'Aktifleştir'}</button>
              <button type="button" onClick={() => onShowLogs(row)}>Loglar</button>
            </td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}

function ZoneTab({ rows, onEdit }) {
  const pagination = usePagedRows(rows);
  return (
    <TableShell emptyText="Henüz proximity zone tanımı yok." pagination={pagination}>
      <thead>
        <tr>
          <th>Zone adı</th>
          <th>Zone kodu</th>
          <th>Tip</th>
          <th>Bağlı reyon</th>
          <th>Açıklama</th>
          <th>Durum</th>
          <th>Beacon sayısı</th>
          <th className="pm-actions-cell">Aksiyonlar</th>
        </tr>
      </thead>
      <tbody>
        {pagination.rows.map((row) => (
          <tr key={row.id}>
            <td>{empty(row.name)}</td>
            <td className="pm-mono">{empty(row.code)}</td>
            <td>{empty(row.type)}</td>
            <td>{empty(row.section?.name || row.sectionId)}</td>
            <td>{empty(row.description)}</td>
            <td><StatusPill value={row.isActive ? 'ACTIVE' : 'PASSIVE'} /></td>
            <td>{row.beaconCount ?? 0}</td>
            <td className="pm-actions-cell">
              <button type="button" onClick={() => onEdit(row)}>Düzenle</button>
            </td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}

function RuleTab({ rows, onEdit, onToggleStatus }) {
  const pagination = usePagedRows(rows);
  return (
    <TableShell emptyText="Henüz bildirim kuralı yok." pagination={pagination}>
      <thead>
        <tr>
          <th>Kural adı</th>
          <th>Hedef</th>
          <th>Tetikleyici</th>
          <th>Zone</th>
          <th>Beacon</th>
          <th>Başlık</th>
          <th>Cooldown</th>
          <th>Öncelik</th>
          <th>Durum</th>
          <th className="pm-actions-cell">Aksiyonlar</th>
        </tr>
      </thead>
      <tbody>
        {pagination.rows.map((row) => (
          <tr key={row.id}>
            <td>{empty(row.name)}</td>
            <td>Müşteri</td>
            <td>{empty(row.trigger)}</td>
            <td>{empty(row.locationZone?.name || row.locationZoneId || 'Global')}</td>
            <td>{empty(row.beaconDevice?.name || row.beaconDevice?.deviceCode || row.beaconDeviceId)}</td>
            <td>{empty(row.title)}</td>
            <td>{formatRuleCooldown(row)}</td>
            <td>{row.priority ?? 0}</td>
            <td><StatusPill value={row.isActive ? 'ACTIVE' : 'PASSIVE'} /></td>
            <td className="pm-actions-cell">
              <button type="button" onClick={() => onEdit(row)}>Düzenle</button>
              <button type="button" onClick={() => onToggleStatus(row)}>{row.isActive ? 'Pasifleştir' : 'Aktifleştir'}</button>
            </td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}

function EventLogTab({ rows, filters, setFilters, onRefresh, loading, beacons, zones }) {
  const pagination = usePagedRows(rows);
  return (
    <>
      <LogFilters filters={filters} setFilters={setFilters} onRefresh={onRefresh} loading={loading}>
        <SelectField label="User type" value={filters.userType || ''} onChange={(value) => setFilters((current) => ({ ...current, userType: value }))} options={TARGET_TYPES} placeholder="Tümü" />
        <SelectField label="Beacon" value={filters.beaconDeviceId || ''} onChange={(value) => setFilters((current) => ({ ...current, beaconDeviceId: value }))} options={beacons} placeholder="Tümü" />
        <SelectField label="Zone" value={filters.locationZoneId || ''} onChange={(value) => setFilters((current) => ({ ...current, locationZoneId: value }))} options={zones} placeholder="Tümü" />
        <SelectField label="Event type" value={filters.eventType || ''} onChange={(value) => setFilters((current) => ({ ...current, eventType: value }))} options={EVENT_TYPES} placeholder="Tümü" />
        <SelectField label="Source" value={filters.source || ''} onChange={(value) => setFilters((current) => ({ ...current, source: value }))} options={SOURCES} placeholder="Tümü" />
      </LogFilters>
      <TableShell emptyText="Seçili filtrelerle event logu bulunamadı." pagination={pagination}>
        <thead>
          <tr>
            <th>Tarih</th>
            <th>Kullanıcı</th>
            <th>User type</th>
            <th>Beacon</th>
            <th>Zone</th>
            <th>RSSI</th>
            <th>Event type</th>
            <th>Source</th>
            <th>Sonuç</th>
            <th>Reason</th>
            <th>Ürün</th>
            <th>Product ID</th>
            <th>Barcode</th>
            <th>Offer source</th>
            <th>Dedupe key</th>
            <th>Dedupe until</th>
          </tr>
        </thead>
        <tbody>
          {pagination.rows.map((row) => (
            <tr key={row.id}>
              <td>{formatDate(row.createdAt)}</td>
              <td>{empty(row.user?.name || row.user?.email || row.userId)}</td>
              <td>{empty(row.userType)}</td>
              <td>{empty(row.beaconDevice?.name || row.beaconDevice?.deviceCode || row.deviceCode)}</td>
              <td>{empty(row.locationZone?.name || row.locationZoneId)}</td>
              <td>{empty(row.rssi)}</td>
              <td>{empty(row.eventType)}</td>
              <td>{empty(row.source)}</td>
              <td>{row.delivery?.status ? <StatusPill value={row.delivery.status} /> : '-'}</td>
              <td>{formatReason(row.delivery?.skipReason || row.reason)}</td>
              <td>{empty(row.productName || row.productId)}</td>
              <td className="pm-mono">{empty(row.productId)}</td>
              <td className="pm-mono">{empty(row.barcode)}</td>
              <td>{empty(row.offerSource)}</td>
              <td className="pm-mono">{empty(row.dedupeKey)}</td>
              <td>{formatDate(row.dedupeUntil)}</td>
            </tr>
          ))}
        </tbody>
      </TableShell>
    </>
  );
}

function DeliveryLogTab({ rows, filters, setFilters, onRefresh, loading, beacons, zones }) {
  const pagination = usePagedRows(rows);
  return (
    <>
      <LogFilters filters={filters} setFilters={setFilters} onRefresh={onRefresh} loading={loading}>
        <SelectField label="Status" value={filters.status || ''} onChange={(value) => setFilters((current) => ({ ...current, status: value }))} options={DELIVERY_STATUSES} placeholder="Tümü" />
        <SelectField label="Beacon" value={filters.beaconDeviceId || ''} onChange={(value) => setFilters((current) => ({ ...current, beaconDeviceId: value }))} options={beacons} placeholder="Tümü" />
        <SelectField label="Zone" value={filters.locationZoneId || ''} onChange={(value) => setFilters((current) => ({ ...current, locationZoneId: value }))} options={zones} placeholder="Tümü" />
      </LogFilters>
      <TableShell emptyText="Seçili filtrelerle delivery/cooldown kaydı bulunamadı." pagination={pagination}>
        <thead>
          <tr>
            <th>Tarih</th>
            <th>Kullanıcı</th>
            <th>Rule</th>
            <th>Notification</th>
            <th>Status</th>
            <th>Skip reason</th>
            <th>Ürün</th>
            <th>Product ID</th>
            <th>Barcode</th>
            <th>Offer source</th>
            <th>Zone</th>
            <th>Beacon</th>
            <th>Dedupe key</th>
            <th>Dedupe until</th>
          </tr>
        </thead>
        <tbody>
          {pagination.rows.map((row) => (
            <tr key={row.id}>
              <td>{formatDate(row.createdAt)}</td>
              <td>{empty(row.user?.name || row.user?.email || row.userId)}</td>
              <td>{empty(row.notificationRule?.name || row.notificationRuleId)}</td>
              <td>{empty(row.notification?.title || row.notificationId)}</td>
              <td><StatusPill value={row.status} /></td>
              <td>{formatReason(row.skipReason || row.reason)}</td>
              <td>{empty(row.productName || row.productId)}</td>
              <td className="pm-mono">{empty(row.productId)}</td>
              <td className="pm-mono">{empty(row.barcode)}</td>
              <td>{empty(row.offerSource)}</td>
              <td>{empty(row.zoneName || row.locationZone?.name || row.locationZoneId)}</td>
              <td>{empty(row.beaconDevice?.name || row.beaconDevice?.deviceCode || row.beaconDeviceId)}</td>
              <td className="pm-mono">{empty(row.dedupeKey)}</td>
              <td>{formatDate(row.dedupeUntil)}</td>
            </tr>
          ))}
        </tbody>
      </TableShell>
    </>
  );
}

function LogFilters({ children, filters, setFilters, onRefresh, loading }) {
  return (
    <div className="pm-filter-bar">
      {children}
      <TextField label="Limit" type="number" value={filters.limit || 30} onChange={(value) => setFilters((current) => ({ ...current, limit: value }))} />
      <button className="pm-secondary-button" type="button" onClick={onRefresh} disabled={loading}>
        <RefreshCw size={16} />
        {loading ? 'Yükleniyor' : 'Filtrele'}
      </button>
    </div>
  );
}

function TableShell({ children, emptyText, pagination = null }) {
  const body = children?.[1];
  const hasRows = pagination
    ? pagination.total > 0
    : body?.props?.children?.length > 0 || Boolean(body?.props?.children?.key);
  return (
    <div className="pm-table-card">
      <div className="pm-table-scroll">
        <table className="pm-table">
          {children}
        </table>
      </div>
      {!hasRows ? <div className="pm-empty-state">{emptyText}</div> : null}
      {pagination && pagination.total > PM_PAGE_SIZE ? <TablePagination pagination={pagination} /> : null}
    </div>
  );
}

function TablePagination({ pagination }) {
  return (
    <div className="pm-pagination" aria-label="Sayfalama">
      <span>{pagination.start}-{pagination.end} / {pagination.total} kayıt</span>
      <div className="pm-pagination-actions">
        <button type="button" className="pm-secondary-button" disabled={pagination.page === 1} onClick={() => pagination.setPage((current) => Math.max(1, current - 1))}>
          Önceki
        </button>
        <strong>Sayfa {pagination.page} / {pagination.totalPages}</strong>
        <button type="button" className="pm-primary-button" disabled={pagination.page === pagination.totalPages} onClick={() => pagination.setPage((current) => Math.min(pagination.totalPages, current + 1))}>
          Sonraki
        </button>
      </div>
    </div>
  );
}

function StatusPill({ value }) {
  const normalized = String(value || 'PASSIVE').toUpperCase();
  return <span className={`pm-status pm-status-${normalized.toLowerCase()}`}>{normalized}</span>;
}

function Modal({ title, description, type, children, onClose, onSubmit, saving, error }) {
  const ModalIcon = type === 'beacon' ? RadioTower : type === 'zone' ? MapPinned : BellRing;
  return (
    <div className="pm-modal-backdrop" role="presentation">
      <form className="pm-modal" onSubmit={onSubmit} noValidate>
        <div className="pm-modal-header">
          <div className="pm-modal-title">
            <span className="pm-modal-icon" aria-hidden="true"><ModalIcon size={18} /></span>
            <span>
              <h3>{title}</h3>
              {description ? <p>{description}</p> : null}
            </span>
          </div>
          <button type="button" onClick={onClose} aria-label="Kapat"><X size={18} /></button>
        </div>
        <div className="pm-modal-body">
          {children}
          {error ? <div className="pm-form-error">{error}</div> : null}
        </div>
        <div className="pm-modal-footer">
          <button className="pm-secondary-button" type="button" onClick={onClose}>Vazgeç</button>
          <button className="pm-primary-button" type="submit" disabled={saving}><Save size={16} /> {saving ? 'Kaydediliyor' : 'Kaydet'}</button>
        </div>
      </form>
    </div>
  );
}

function modalTitle(modal) {
  if (modal.type === 'beacon') return modal.id ? 'Beacon Cihazını Düzenle' : 'Yeni Beacon Ekle';
  if (modal.type === 'zone') return modal.id ? 'Yakınlık Alanını Düzenle' : 'Yeni Yakınlık Alanı Ekle';
  return modal.id ? 'Bildirim Kuralını Düzenle' : 'Yeni Bildirim Kuralı Ekle';
}

function BeaconForm({ form, errors = {}, updateForm, zoneOptions, sectionOptions, eslDeviceOptions }) {
  const filteredZoneOptions = form.sectionId
    ? zoneOptions.filter((zone) => !zone.sectionId || zone.sectionId === form.sectionId || zone.value === form.locationZoneId)
    : zoneOptions;
  return (
    <>
      <FormSection title="Temel Bilgiler">
        <TextField label="Cihaz Adı" value={form.name} onChange={(value) => updateForm('name', value)} required placeholder="Örn: Süt Reyonu Beacon 1" help="Bu cihazı panelde hangi adla görmek istiyorsunuz?" error={errors.name} />
        <TextField label="Cihaz Kodu" value={form.deviceCode} onChange={(value) => updateForm('deviceCode', value)} required placeholder="Örn: esp_sut_01" help="Cihazı sistem içinde tanımlayan kısa benzersiz kod." error={errors.deviceCode} />
        <SelectField
          label="Bağlı Etiket / ESL Cihazı"
          value={form.eslDeviceId}
          onChange={(value) => {
            updateForm('eslDeviceId', value);
            if (value) updateForm('clearEslDeviceLink', false);
          }}
          options={eslDeviceOptions}
          placeholder="Etiket seçin"
          help="Bu beacon hangi elektronik etiket cihazı ile ilişkilendirilecek?"
        />
        {!form.eslDeviceId ? (
          <div className="pm-field pm-field-wide">
            <small className="pm-inline-warning">
              Bu beacon bir elektronik etiketle eşleşmezse indirimli ürün bildirimi üretilemez.
              {form.originalEslDeviceId && form.clearEslDeviceLink !== true ? ' Kaydettiğinizde mevcut ESL bağlantısı korunur.' : ''}
            </small>
          </div>
        ) : null}
        {form.originalEslDeviceId ? (
          <div className="pm-field pm-field-wide">
            <button
              type="button"
              className="pm-secondary-button"
              onClick={() => {
                updateForm('eslDeviceId', '');
                updateForm('clearEslDeviceLink', true);
              }}
            >
              ESL bağlantısını kaldır
            </button>
          </div>
        ) : null}
        <SelectField label="Eşleşen Reyon" value={form.sectionId} onChange={(value) => updateForm('sectionId', value)} options={sectionOptions} placeholder="Reyon seçin" help="Beacon'ın bağlı olduğu reyonu seçin." />
        <SelectField label="Eşleşen Yakınlık Alanı" value={form.locationZoneId} onChange={(value) => updateForm('locationZoneId', value)} options={filteredZoneOptions} placeholder="Yakınlık alanı seçin" help="Beacon'ın bulunduğu yakınlık alanını seçin." />
        <SelectField label="Durum" value={form.status} onChange={(value) => updateForm('status', value)} options={BEACON_STATUS_OPTIONS} required placeholder="Durum seçin" help="Cihaz aktifse müşteri algılama için kullanılabilir." error={errors.status} />
      </FormSection>
      <AdvancedSection>
        <TextField label="UUID" value={form.uuid} onChange={(value) => updateForm('uuid', value)} placeholder="Örn: FDA50693-A4E2-4FB1-AFCF-C6EB07647825" help="Beacon cihazının benzersiz kimliği." />
        <TextField label="Major" type="number" value={form.major} onChange={(value) => updateForm('major', value)} placeholder="Örn: 100" help="Beacon sinyal grubu numarası." />
        <TextField label="Minor" type="number" value={form.minor} onChange={(value) => updateForm('minor', value)} placeholder="Örn: 1" help="Beacon alt cihaz numarası." />
        <TextField label="Firmware" value={form.firmwareVersion} onChange={(value) => updateForm('firmwareVersion', value)} placeholder="Örn: 1.0.3" help="İsteğe bağlı cihaz sürüm bilgisi." />
        <TextAreaField label="Metadata JSON" value={form.metadata} onChange={(value) => updateForm('metadata', value)} rows={3} placeholder='{"mount": "süt reyonu"}' help="Sadece teknik kullanım içindir." />
      </AdvancedSection>
    </>
  );
}

function ZoneForm({ form, errors = {}, updateForm, sectionOptions }) {
  return (
    <>
      <FormSection title="Temel Bilgiler">
        <TextField label="Alan Adı" value={form.name} onChange={(value) => updateForm('name', value)} required placeholder="Örn: Süt Reyonu Giriş Alanı" help="Panelde görünecek alan adı." error={errors.name} />
        <TextField label="Alan Kodu" value={form.code} onChange={(value) => updateForm('code', value)} required placeholder="Örn: zone_sut_giris" help="Sistem içinde kullanılacak kısa kod." error={errors.code} />
        <SelectField label="Alan Tipi" value={form.type} onChange={(value) => updateForm('type', value)} options={ZONE_TYPE_OPTIONS} required placeholder="Alan tipi seçin" help="Bu alanın mağaza içindeki türünü seçin." error={errors.type} />
        <SelectField label="Bağlı Reyon / Bölüm" value={form.sectionId} onChange={(value) => updateForm('sectionId', value)} options={sectionOptions} placeholder="Reyon seçin" help="Bu alan hangi reyon veya bölüme ait?" />
        <ToggleField label="Aktif" checked={form.isActive} onChange={(value) => updateForm('isActive', value)} help="Aktif alanlar bildirim senaryolarında kullanılabilir." />
        <TextAreaField label="Açıklama" value={form.description} onChange={(value) => updateForm('description', value)} rows={3} placeholder="Örn: Süt dolaplarının ön kısmı" help="İsteğe bağlı kısa not." />
      </FormSection>
      <AdvancedSection>
        <TextAreaField label="Metadata JSON" value={form.metadata} onChange={(value) => updateForm('metadata', value)} rows={3} placeholder='{"not": "teknik bilgi"}' help="Sadece teknik kullanım içindir." />
      </AdvancedSection>
    </>
  );
}

function RuleForm({ form, errors = {}, updateForm, zoneOptions, beaconOptions }) {
  const isGlobalRule = !form.locationZoneId && !form.beaconDeviceId;
  return (
    <>
      <FormSection title="Kural Bilgileri">
        <TextField label="Kural Adı" value={form.name} onChange={(value) => updateForm('name', value)} required placeholder="Örn: Süt Reyonu Kampanya Bildirimi" help="Bu kuralı panelde hangi adla görmek istiyorsunuz?" error={errors.name} />
        <SelectField label="Bildirim Kime Gösterilsin?" value={form.targetType} onChange={() => updateForm('targetType', 'customer')} options={TARGET_TYPE_OPTIONS} required help="Şu anda müşteri bildirimleri desteklenir." error={errors.targetType} />
        <SelectField label="Bildirim Ne Zaman Çıksın?" value={form.trigger} onChange={(value) => updateForm('trigger', value)} options={TRIGGER_OPTIONS} required placeholder="Zaman seçin" help="Bildirim senaryosunu başlatacak müşteri hareketi." error={errors.trigger} />
        <SelectField label="Hangi Yakınlık Alanında?" value={form.locationZoneId} onChange={(value) => updateForm('locationZoneId', value)} options={zoneOptions} placeholder="Tüm alanlarda" help="Belirli bir alan seçmezseniz kural tüm alanlarda kullanılabilir." />
        <SelectField label="Hangi Beacon?" value={form.beaconDeviceId} onChange={(value) => updateForm('beaconDeviceId', value)} options={beaconOptions} placeholder="Tüm beaconlar" help="İsteğe bağlı. Sadece belirli bir beacon için sınırlandırmak isterseniz seçin." />
        <ToggleField label="Aktif" checked={form.isActive} onChange={(value) => updateForm('isActive', value)} help="Aktif kurallar müşteri bildirimlerinde değerlendirilir." />
        <div className={`pm-rule-note ${isGlobalRule ? '' : 'pm-rule-note-hidden'}`} aria-hidden={!isGlobalRule}>
          {isGlobalRule ? 'Alan ve beacon seçilmezse bu kural tüm alanlarda yedek kural olarak çalışır.' : '\u00a0'}
        </div>
      </FormSection>
      <FormSection title="Bildirim İçeriği">
        <TextField label="Bildirim Başlığı" value={form.title} onChange={(value) => updateForm('title', value)} required placeholder="Örn: Bu reyonda indirimli ürünler var" error={errors.title} />
        <TextAreaField label="Bildirim Mesajı" value={form.message} onChange={(value) => updateForm('message', value)} rows={3} placeholder="Örn: İlgini çekebilecek fırsatları görmek için dokun." error={errors.message} />
        <TextField label="Buton Yazısı" value={form.actionLabel} onChange={(value) => updateForm('actionLabel', value)} placeholder="Örn: Ürünleri Gör" />
        <TextField label="Gidilecek Sayfa / Link" value={form.actionUrl} onChange={(value) => updateForm('actionUrl', value)} placeholder="/musteri/kampanyalar" help="Müşteri butona bastığında açılacak sayfa." error={errors.actionUrl} />
      </FormSection>
      <FormSection title="Tekrar Ayarları">
        <TextField label="Aynı müşteriye tekrar gösterme süresi" type="number" value={form.cooldownMinutes} onChange={(value) => updateForm('cooldownMinutes', value)} required placeholder="30" suffix="dakika" help="Aynı bildirim seçilen süre boyunca tekrar gösterilmez." error={errors.cooldownMinutes} />
        <TextField label="Ziyaret Başına Limit" type="number" value={form.maxPerVisit} onChange={(value) => updateForm('maxPerVisit', value)} placeholder="Boş bırakılırsa sınırsız" help="Bir müşteri bu ziyarette en fazla kaç kez görsün?" />
      </FormSection>
      <AdvancedSection>
        <TextField label="Öncelik" type="number" value={form.priority} onChange={(value) => updateForm('priority', value)} placeholder="0" help="Birden fazla kural varsa hangisinin öne çıkacağını belirler." />
        <SelectField label="Aksiyon Tipi" value={form.actionType} onChange={(value) => updateForm('actionType', value)} options={ACTION_TYPE_OPTIONS} placeholder="Aksiyon tipi seçin" help="Teknik aksiyon tipi. Varsayılan olarak uygulama sayfası kullanılır." />
        <TextAreaField label="Payload JSON" value={form.payload} onChange={(value) => updateForm('payload', value)} rows={3} placeholder='{"actionLabel": "Ürünleri Gör"}' help="Sadece teknik kullanım içindir." />
      </AdvancedSection>
    </>
  );
}
