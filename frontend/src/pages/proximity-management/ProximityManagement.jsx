import { useEffect, useMemo, useState } from 'react';
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
const REASON_LABELS = {
  PRODUCT_DISCOUNT_ALREADY_NOTIFIED_12H: 'Bu ürün için yakın zamanda bildirim gönderildi',
  NO_ACTIVE_DISCOUNT_FOR_LABEL_PRODUCT: 'Etiketteki üründe aktif indirim yok',
  UNKNOWN_BEACON: 'Beacon eşleşmedi',
  NOT_AUTHENTICATED: 'Müşteri oturumu yok',
};

const empty = (value) => {
  if (value === null || value === undefined || value === '') return '-';
  return value;
};

const formatReason = (value) => {
  const code = String(value || '').trim();
  if (!code) return '-';
  if (code === 'PRODUCT_DISCOUNT_ALREADY_NOTIFIED_12H') return 'Bu \u00fcr\u00fcn i\u00e7in yak\u0131n zamanda bildirim g\u00f6nderildi';
  if (code === 'NO_ACTIVE_DISCOUNT_FOR_LABEL_PRODUCT') return 'Etiketteki \u00fcr\u00fcnde aktif indirim yok';
  if (code === 'UNKNOWN_BEACON') return 'Beacon e\u015fle\u015fmedi';
  if (code === 'NOT_AUTHENTICATED') return 'M\u00fc\u015fteri oturumu yok';
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

function SelectField({ label, value, onChange, options, placeholder = 'Seçiniz', required = false }) {
  return (
    <label className="pm-field">
      <span>{label}{required ? ' *' : ''}</span>
      <select value={value ?? ''} onChange={(event) => onChange(event.target.value)}>
        <option value="">{placeholder}</option>
        {options.map((option) => {
          const optionValue = typeof option === 'string' ? option : option.value;
          const optionLabel = typeof option === 'string' ? option : option.label;
          return (
            <option key={optionValue || 'empty'} value={optionValue}>
              {optionLabel}
            </option>
          );
        })}
      </select>
    </label>
  );
}

function TextField({ label, value, onChange, type = 'text', required = false, placeholder = '' }) {
  return (
    <label className="pm-field">
      <span>{label}{required ? ' *' : ''}</span>
      <input type={type} value={value ?? ''} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function TextAreaField({ label, value, onChange, rows = 3, placeholder = '' }) {
  return (
    <label className="pm-field pm-field-wide">
      <span>{label}</span>
      <textarea rows={rows} value={value ?? ''} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function ToggleField({ label, checked, onChange }) {
  return (
    <label className="pm-toggle-field">
      <input type="checkbox" checked={Boolean(checked)} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
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
  const [saving, setSaving] = useState(false);

  const sectionOptions = useMemo(
    () => sections.map((section) => ({ value: section.id, label: section.name || section.title || section.code || section.id })),
    [sections]
  );
  const zoneOptions = useMemo(
    () => zones.map((zone) => ({ value: zone.id, label: `${zone.name || zone.code || zone.id}${zone.code ? ` (${zone.code})` : ''}` })),
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

  const loadBaseData = async () => {
    setLoading(true);
    setError('');
    try {
      const [beaconRows, zoneRows, ruleRows, sectionRows, eslDeviceRows] = await Promise.all([
        proximityAdminService.getBeacons({ limit: 100 }),
        proximityAdminService.getZones({ limit: 100 }),
        proximityAdminService.getRules({ limit: 100 }),
        sectionService.list({ forceRefresh: true }),
        eslService.listDevices(),
      ]);
      setBeacons(toRows(beaconRows));
      setZones(toRows(zoneRows));
      setRules(toRows(ruleRows));
      setSections(toRows(sectionRows));
      setEslDevices(toRows(eslDeviceRows));
    } catch (err) {
      setError(err?.message || 'Proximity yönetimi verileri alınamadı.');
    } finally {
      setLoading(false);
    }
  };

  const loadLogs = async () => {
    setLogLoading(true);
    try {
      const [eventRows, deliveryRows] = await Promise.all([
        proximityAdminService.getEvents(eventFilters),
        proximityAdminService.getDeliveries(deliveryFilters),
      ]);
      setEvents(toRows(eventRows));
      setDeliveries(toRows(deliveryRows));
    } catch (err) {
      setError(err?.message || 'Loglar alınamadı.');
    } finally {
      setLogLoading(false);
    }
  };

  useEffect(() => {
    loadBaseData();
  }, []);

  useEffect(() => {
    if (activeTab === 'events' || activeTab === 'deliveries' || activeTab === 'summary') {
      loadLogs();
    }
  }, [activeTab]);

  const updateForm = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const openBeaconModal = (beacon = null) => {
    setFormError('');
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
      metadata: stringifyJson(beacon?.metadata),
    });
  };

  const openZoneModal = (zone = null) => {
    setFormError('');
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

  const submitModal = async (event) => {
    event.preventDefault();
    if (!modal) return;

    setSaving(true);
    setFormError('');
    try {
      if (modal.type === 'beacon') {
        if (!String(form.deviceCode || '').trim()) throw new Error('Device ID / Code boş olamaz.');
        const payload = {
          ...form,
          major: form.major === '' ? null : Number(form.major),
          minor: form.minor === '' ? null : Number(form.minor),
          locationZoneId: form.locationZoneId || null,
          sectionId: form.sectionId || null,
          eslDeviceId: form.eslDeviceId || null,
          metadata: {
            ...parseJsonField(form.metadata, {}),
            ...(form.eslDeviceId ? { eslDeviceId: form.eslDeviceId } : {}),
          },
        };
        if (!form.eslDeviceId) delete payload.metadata.eslDeviceId;
        delete payload.metadataText;
        if (modal.id) await proximityAdminService.updateBeacon(modal.id, payload);
        else await proximityAdminService.createBeacon(payload);
      }

      if (modal.type === 'zone') {
        if (!String(form.name || '').trim()) throw new Error('Zone adı boş olamaz.');
        if (!String(form.code || '').trim()) throw new Error('Zone kodu boş olamaz.');
        const payload = {
          ...form,
          sectionId: form.sectionId || null,
          metadata: parseJsonField(form.metadata, null),
        };
        if (modal.id) await proximityAdminService.updateZone(modal.id, payload);
        else await proximityAdminService.createZone(payload);
      }

      if (modal.type === 'rule') {
        if (!form.targetType) throw new Error('Hedef seçilmelidir.');
        if (!form.trigger) throw new Error('Tetikleyici seçilmelidir.');
        if (!String(form.title || '').trim() || !String(form.message || '').trim()) {
          throw new Error('Başlık ve mesaj boş olamaz.');
        }
        if (Number(form.cooldownMinutes) <= 0) throw new Error('Cooldown dakikası pozitif olmalıdır.');
        if (form.actionUrl && form.targetType === 'customer' && !String(form.actionUrl).startsWith('/musteri')) {
          throw new Error('Müşteri kuralı için actionUrl /musteri ile başlamalıdır.');
        }
        if (form.actionUrl && !String(form.actionUrl).startsWith('/musteri')) {
          throw new Error('Proximity actionUrl /musteri ile başlamalıdır.');
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

      setModal(null);
      await loadBaseData();
      if (activeTab === 'events' || activeTab === 'deliveries' || activeTab === 'summary') {
        await loadLogs();
      }
    } catch (err) {
      setFormError(err?.message || 'Kayıt işlemi tamamlanamadı.');
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
      return <button className="pm-primary-button" type="button" onClick={() => openBeaconModal()}><Plus size={16} /> Yeni cihaz</button>;
    }
    if (activeTab === 'zones') {
      return <button className="pm-primary-button" type="button" onClick={() => openZoneModal()}><Plus size={16} /> Yeni zone</button>;
    }
    if (activeTab === 'rules') {
      return <button className="pm-primary-button" type="button" onClick={() => openRuleModal()}><Plus size={16} /> Yeni kural</button>;
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
        <Modal title={modalTitle(modal)} type={modal.type} onClose={() => setModal(null)} onSubmit={submitModal} saving={saving} error={formError}>
          {modal.type === 'beacon' ? (
            <BeaconForm form={form} updateForm={updateForm} zoneOptions={zoneOptions} sectionOptions={sectionOptions} eslDeviceOptions={eslDeviceOptions} />
          ) : null}
          {modal.type === 'zone' ? (
            <ZoneForm form={form} updateForm={updateForm} sectionOptions={sectionOptions} />
          ) : null}
          {modal.type === 'rule' ? (
            <RuleForm form={form} updateForm={updateForm} zoneOptions={zoneOptions} beaconOptions={beaconOptions} />
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
  const hasRows = body?.props?.children?.length > 0 || Boolean(body?.props?.children?.key);
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

function Modal({ title, type, children, onClose, onSubmit, saving, error }) {
  const ModalIcon = type === 'beacon' ? RadioTower : type === 'zone' ? MapPinned : BellRing;
  return (
    <div className="pm-modal-backdrop" role="presentation">
      <form className="pm-modal" onSubmit={onSubmit}>
        <div className="pm-modal-header">
          <div className="pm-modal-title">
            <span className="pm-modal-icon" aria-hidden="true"><ModalIcon size={18} /></span>
            <h3>{title}</h3>
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
  if (modal.type === 'beacon') return modal.id ? 'Beacon cihazını düzenle' : 'Yeni beacon cihazı';
  if (modal.type === 'zone') return modal.id ? 'Zone eşleştirmesini düzenle' : 'Yeni proximity zone';
  return modal.id ? 'Bildirim kuralını düzenle' : 'Yeni bildirim kuralı';
}

function BeaconForm({ form, updateForm, zoneOptions, sectionOptions, eslDeviceOptions }) {
  return (
    <div className="pm-form-grid">
      <TextField label="Cihaz adı" value={form.name} onChange={(value) => updateForm('name', value)} />
      <TextField label="Device ID / Code" value={form.deviceCode} onChange={(value) => updateForm('deviceCode', value)} required />
      <TextField label="UUID" value={form.uuid} onChange={(value) => updateForm('uuid', value)} />
      <TextField label="Major" type="number" value={form.major} onChange={(value) => updateForm('major', value)} />
      <TextField label="Minor" type="number" value={form.minor} onChange={(value) => updateForm('minor', value)} />
      <SelectField label="Bağlı ESL / Etiket Cihazı" value={form.eslDeviceId} onChange={(value) => updateForm('eslDeviceId', value)} options={eslDeviceOptions} placeholder="ESL seçilmedi" />
      <SelectField label="Eşleşen Zone" value={form.locationZoneId} onChange={(value) => updateForm('locationZoneId', value)} options={zoneOptions} placeholder="Zone seçilmedi" />
      <SelectField label="Eşleşen Reyon" value={form.sectionId} onChange={(value) => updateForm('sectionId', value)} options={sectionOptions} placeholder="Reyon seçilmedi" />
      <SelectField label="Durum" value={form.status} onChange={(value) => updateForm('status', value)} options={BEACON_STATUSES} required />
      <TextField label="Firmware" value={form.firmwareVersion} onChange={(value) => updateForm('firmwareVersion', value)} />
      <TextAreaField label="Metadata JSON" value={form.metadata} onChange={(value) => updateForm('metadata', value)} rows={4} placeholder='{"mount": "süt reyonu"}' />
    </div>
  );
}

function ZoneForm({ form, updateForm, sectionOptions }) {
  return (
    <div className="pm-form-grid">
      <TextField label="Zone adı" value={form.name} onChange={(value) => updateForm('name', value)} required />
      <TextField label="Zone kodu" value={form.code} onChange={(value) => updateForm('code', value)} required />
      <SelectField label="Zone tipi" value={form.type} onChange={(value) => updateForm('type', value)} options={ZONE_TYPES} required />
      <SelectField label="Bağlı reyon/section" value={form.sectionId} onChange={(value) => updateForm('sectionId', value)} options={sectionOptions} placeholder="Reyon seçilmedi" />
      <ToggleField label="Aktif" checked={form.isActive} onChange={(value) => updateForm('isActive', value)} />
      <TextAreaField label="Açıklama" value={form.description} onChange={(value) => updateForm('description', value)} />
      <TextAreaField label="Metadata JSON" value={form.metadata} onChange={(value) => updateForm('metadata', value)} rows={4} />
    </div>
  );
}

function RuleForm({ form, updateForm, zoneOptions, beaconOptions }) {
  return (
    <div className="pm-form-grid">
      <TextField label="Kural adı" value={form.name} onChange={(value) => updateForm('name', value)} required />
      <SelectField label="Hedef" value={form.targetType} onChange={() => updateForm('targetType', 'customer')} options={[
        { value: 'customer', label: 'Müşteri' },
      ]} required />
      <SelectField label="Tetikleyici" value={form.trigger} onChange={(value) => updateForm('trigger', value)} options={TRIGGERS} required />
      <SelectField label="Zone" value={form.locationZoneId} onChange={(value) => updateForm('locationZoneId', value)} options={zoneOptions} placeholder="Global rule" />
      <SelectField label="Beacon" value={form.beaconDeviceId} onChange={(value) => updateForm('beaconDeviceId', value)} options={beaconOptions} placeholder="Beacon seçilmedi" />
      <TextField label="Başlık" value={form.title} onChange={(value) => updateForm('title', value)} required />
      <TextAreaField label="Mesaj" value={form.message} onChange={(value) => updateForm('message', value)} />
      <SelectField label="Action type" value={form.actionType} onChange={(value) => updateForm('actionType', value)} options={ACTION_TYPES} />
      <TextField label="Action URL" value={form.actionUrl} onChange={(value) => updateForm('actionUrl', value)} placeholder="/musteri/kampanyalar veya /musteri/kategori/sut" />
      <TextField label="Action label" value={form.actionLabel} onChange={(value) => updateForm('actionLabel', value)} placeholder="Kampanyayı Gör" />
      <TextField label="Cooldown dakika" type="number" value={form.cooldownMinutes} onChange={(value) => updateForm('cooldownMinutes', value)} required />
      <TextField label="Ziyaret başı limit" type="number" value={form.maxPerVisit} onChange={(value) => updateForm('maxPerVisit', value)} />
      <TextField label="Öncelik" type="number" value={form.priority} onChange={(value) => updateForm('priority', value)} />
      <ToggleField label="Aktif" checked={form.isActive} onChange={(value) => updateForm('isActive', value)} />
      {!form.locationZoneId && !form.beaconDeviceId ? (
        <div className="pm-rule-note">Zone ve beacon seçilmezse bu kural global fallback olarak çalışır.</div>
      ) : null}
      <TextAreaField label="Payload JSON" value={form.payload} onChange={(value) => updateForm('payload', value)} rows={4} />
    </div>
  );
}
