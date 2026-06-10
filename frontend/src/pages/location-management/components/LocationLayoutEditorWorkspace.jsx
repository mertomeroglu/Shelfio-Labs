import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Layers, X, AlertCircle, Package } from 'lucide-react';
import { useBlocker } from 'react-router-dom';
import ConfirmModal from '../../../components/ConfirmModal.jsx';
import {
  locationLayoutService,
  normalizeLayoutItemForEditor,
  resolveLayoutBoundary,
  isLayoutItemUserLocked,
} from '../../../services/locationLayoutService.js';
import { sectionService } from '../../../services/sectionService.js';
import LocationLayoutToolbar from './LocationLayoutToolbar.jsx';
import LocationObjectPalette from './LocationObjectPalette.jsx';
import LocationLayoutEditableCanvas from './LocationLayoutEditableCanvas.jsx';
import LocationObjectPropertiesPanel from './LocationObjectPropertiesPanel.jsx';

const GRID_SIZE = 10;
const HISTORY_LIMIT = 100;
const COMMON_AREA_TYPES = new Set(['section_common_area', 'warehouse_common_area']);
const DEFAULT_VIEWPORT = { width: 900, height: 640 };

const cloneItems = (items) => JSON.parse(JSON.stringify(items || []));
const snapshotsEqual = (left, right) => JSON.stringify(left || []) === JSON.stringify(right || []);

const sanitizeItem = (item) => {
  const rotation = [0, 90, 180, 270].includes(Number(item.rotation))
    ? Number(item.rotation)
    : 0;
  return {
    ...item,
    x: Math.max(0, Number(item.x) || 0),
    y: Math.max(0, Number(item.y) || 0),
    width: Math.max(5, Number(item.width) || 5),
    height: Math.max(5, Number(item.height) || 5),
    rotation,
  };
};

const isEditableObject = (item) => (
  Boolean(item)
  && (
    !isLayoutItemUserLocked(item)
    || COMMON_AREA_TYPES.has(item.objectType)
  )
);

const ensureSelection = (items, selectedObjectId) => (
  selectedObjectId && items.some((item) => String(item.id) === String(selectedObjectId))
    ? selectedObjectId
    : null
);

const formatInitialDraftItems = (items = []) => items.map((item) => normalizeLayoutItemForEditor({
  ...item,
  metadata: item.metadata || item.properties?.metadata || {},
  properties: {
    color: item.color,
    isVisible: item.isVisible,
    linkedWarehouseLocationId: item.linkedWarehouseLocationId || null,
    linkedProductId: item.linkedProductId || null,
    locationCodeSnapshot: item.locationCodeSnapshot || null,
    metadata: item.metadata || item.properties?.metadata || {},
    ...(item.properties || {}),
  },
}));

const createHistoryState = (items = []) => ({
  past: [],
  future: [],
  baseline: cloneItems(items),
});

const applyHistoryEntry = (state, nextItems, initialItems) => {
  if (snapshotsEqual(nextItems, initialItems)) return state;
  const nextPast = [...state.past, cloneItems(initialItems)];
  return {
    ...state,
    past: nextPast.slice(-HISTORY_LIMIT),
    future: [],
  };
};

const createNewItem = ({ type, index, viewportCenter, items, boundary }) => {
  const baseSize = {
    section: { width: 40, height: 240 },
    shelf: { width: 40, height: 30 },
    warehouse_location: { width: 72, height: 22 },
    aisle: { width: 180, height: 34 },
    zone: { width: 180, height: 120 },
    service_area: { width: 84, height: 58 },
    custom: { width: 78, height: 56 },
  }[type] || { width: 58, height: 58 };
  const itemBoundary = boundary || { x: 0, y: 0, width: 1200, height: 800 };
  const maxX = Math.max(0, itemBoundary.x + itemBoundary.width - baseSize.width);
  const maxY = Math.max(0, itemBoundary.y + itemBoundary.height - baseSize.height);
  const startX = Math.max(itemBoundary.x, Math.min(maxX, Math.round(viewportCenter.x - baseSize.width / 2)));
  const startY = Math.max(itemBoundary.y, Math.min(maxY, Math.round(viewportCenter.y - baseSize.height / 2)));

  let x = startX;
  let y = startY;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const overlaps = items.some((item) => (
      Math.abs((Number(item.x) || 0) - x) < 8
      && Math.abs((Number(item.y) || 0) - y) < 8
    ));
    if (!overlaps) break;
    x = Math.max(itemBoundary.x, Math.min(maxX, startX + attempt * 12));
    y = Math.max(itemBoundary.y, Math.min(maxY, startY + attempt * 12));
  }

  return {
    id: `local-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    objectType: type,
    label: `${type.charAt(0).toUpperCase() + type.slice(1)} ${index + 1}`,
    x,
    y,
    width: baseSize.width,
    height: baseSize.height,
    rotation: 0,
    color: '',
    isLocked: false,
    isVisible: true,
    properties: {
      color: '',
      isLocked: false,
      isVisible: true,
      locationCodeSnapshot: null,
    },
  };
};

export default function LocationLayoutEditorWorkspace({
  layout,
  onClose,
  onLayoutUpdated = () => {},
  canPublish = false,
  isModal = false,
}) {
  const [activeLayout, setActiveLayout] = useState(null);
  const [draftItems, setDraftItems] = useState([]);
  const [selectedObjectId, setSelectedObjectId] = useState(null);
  const [isDirty, setIsDirty] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState('idle');
  const [publishStatus, setPublishStatus] = useState('idle');
  const [errorMsg, setErrorMsg] = useState(null);
  const [zoom, setZoom] = useState(0.85);
  const [pan, setPan] = useState({ x: 100, y: 50 });
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [history, setHistory] = useState(createHistoryState());
  const [fitTrigger, setFitTrigger] = useState(0);
  const [pendingExitMode, setPendingExitMode] = useState(null);
  const [viewportSize, setViewportSize] = useState(DEFAULT_VIEWPORT);
  const [showSectionCreateModal, setShowSectionCreateModal] = useState(false);
  const [sectionCreateForm, setSectionCreateForm] = useState({ name: '', number: '', description: '' });
  const [sectionCreateError, setSectionCreateError] = useState(null);
  const [sectionCreateLoading, setSectionCreateLoading] = useState(false);

  const historyRef = useRef(history);
  const draftItemsRef = useRef(draftItems);
  const selectedObjectIdRef = useRef(selectedObjectId);
  const keyboardMoveSessionRef = useRef(null);
  const popstateGuardRef = useRef(false);
  const blocker = useBlocker(!isModal && isDirty);

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  useEffect(() => {
    draftItemsRef.current = draftItems;
  }, [draftItems]);

  useEffect(() => {
    selectedObjectIdRef.current = selectedObjectId;
  }, [selectedObjectId]);

  const updateDirtyState = useCallback((nextItems, baseline = historyRef.current.baseline) => {
    setIsDirty(!snapshotsEqual(nextItems, baseline));
  }, []);

  const replaceDraftItems = useCallback((nextItems, options = {}) => {
    const sanitizedNextItems = nextItems.map(sanitizeItem);
    if (options.commit && options.initialItems) {
      setHistory((current) => applyHistoryEntry(current, sanitizedNextItems, options.initialItems));
    }
    setDraftItems(sanitizedNextItems);
    setSelectedObjectId((current) => ensureSelection(sanitizedNextItems, options.selectedObjectId ?? current));
    updateDirtyState(sanitizedNextItems);
  }, [updateDirtyState]);

  useEffect(() => {
    if (!layout) return;

    const initDraftLayout = async () => {
      try {
        setIsLoading(true);
        setErrorMsg(null);

        const drafts = await locationLayoutService.list({
          storeId: layout.storeId,
          status: 'draft',
        });

        let loadedItems = [];
        let loadedLayout = null;
        if (drafts && drafts.length > 0) {
          const dbDraft = await locationLayoutService.getById(drafts[0].id, { view: 'editor' });
          loadedLayout = dbDraft;
          loadedItems = formatInitialDraftItems(dbDraft.items || []);
        } else {
          loadedItems = formatInitialDraftItems(layout.items || []);
        }

        setActiveLayout(loadedLayout);
        setDraftItems(loadedItems);
        setSelectedObjectId(null);
        setHistory(createHistoryState(loadedItems));
        setIsDirty(false);
      } catch (err) {
        console.error('Taslak plan yukleme hatasi:', err);
        const realMsg = err.payload?.message || err.payload?.error || err.message;
        setErrorMsg(realMsg || 'Taslak plan yüklenirken hata oluştu.');
      } finally {
        setIsLoading(false);
      }
    };

    initDraftLayout();
  }, [layout]);

  useEffect(() => {
    const handleBeforeUnload = (event) => {
      if (!isDirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  useEffect(() => {
    if (isModal || popstateGuardRef.current) return;
    window.history.pushState({ locationLayoutEditor: true }, '', window.location.href);
    popstateGuardRef.current = true;
  }, [isModal]);

  useEffect(() => {
    const root = document.querySelector('.lm-layout-editor-workspace-root');
    if (!root) return undefined;
    const blockHorizontalWheel = (event) => {
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      event.preventDefault();
    };
    root.addEventListener('wheel', blockHorizontalWheel, { passive: false });
    return () => root.removeEventListener('wheel', blockHorizontalWheel);
  }, []);

  useEffect(() => {
    if (isModal) return undefined;
    const handlePopState = () => {
      if (!isDirty) {
        onClose();
        return;
      }
      window.history.pushState({ locationLayoutEditor: true }, '', window.location.href);
      setPendingExitMode('discard');
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [isDirty, isModal, onClose]);

  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    setPendingExitMode('route');
  }, [blocker.state]);

  const commitKeyboardMove = useCallback(() => {
    const session = keyboardMoveSessionRef.current;
    if (!session) return;
    keyboardMoveSessionRef.current = null;
    window.clearTimeout(session.timeoutId);
    replaceDraftItems(draftItemsRef.current, {
      commit: true,
      initialItems: session.initialItems,
      selectedObjectId: session.selectedObjectId,
    });
  }, [replaceDraftItems]);

  useEffect(() => () => {
    const session = keyboardMoveSessionRef.current;
    if (session) window.clearTimeout(session.timeoutId);
  }, []);

  const beginKeyboardMoveSession = useCallback((initialItems, itemId) => {
    const current = keyboardMoveSessionRef.current;
    if (current) {
      window.clearTimeout(current.timeoutId);
      current.timeoutId = window.setTimeout(commitKeyboardMove, 180);
      return current;
    }
    const nextSession = {
      initialItems: cloneItems(initialItems),
      selectedObjectId: itemId,
      timeoutId: window.setTimeout(commitKeyboardMove, 180),
    };
    keyboardMoveSessionRef.current = nextSession;
    return nextSession;
  }, [commitKeyboardMove]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (isLoading) return;
      const target = event.target;
      const targetTag = target?.tagName?.toLowerCase();
      const isFormField = (
        target?.isContentEditable
        || targetTag === 'input'
        || targetTag === 'textarea'
        || targetTag === 'select'
      );
      if (!isFormField && ((event.ctrlKey || event.metaKey) && !event.altKey)) {
        const key = event.key.toLowerCase();
        if (key === 'z' && !event.shiftKey) {
          event.preventDefault();
          if (historyRef.current.past.length > 0) {
            const previous = historyRef.current.past[historyRef.current.past.length - 1];
            setHistory((current) => ({
              ...current,
              past: current.past.slice(0, current.past.length - 1),
              future: [cloneItems(draftItemsRef.current), ...current.future],
            }));
            setDraftItems(previous);
            setSelectedObjectId((current) => ensureSelection(previous, current));
            updateDirtyState(previous);
          }
          return;
        }
        if (key === 'y' || (key === 'z' && event.shiftKey)) {
          event.preventDefault();
          if (historyRef.current.future.length > 0) {
            const next = historyRef.current.future[0];
            setHistory((current) => ({
              ...current,
              past: [...current.past, cloneItems(draftItemsRef.current)].slice(-HISTORY_LIMIT),
              future: current.future.slice(1),
            }));
            setDraftItems(next);
            setSelectedObjectId((current) => ensureSelection(next, current));
            updateDirtyState(next);
          }
          return;
        }
      }
      if (isFormField) return;

      const deltaMap = {
        ArrowUp: { x: 0, y: -1 },
        ArrowDown: { x: 0, y: 1 },
        ArrowLeft: { x: -1, y: 0 },
        ArrowRight: { x: 1, y: 0 },
      };
      const delta = deltaMap[event.key];
      if (!delta) return;

      const currentItems = draftItemsRef.current;
      const selectedItem = currentItems.find((item) => String(item.id) === String(selectedObjectIdRef.current));
      if (!selectedItem || !isEditableObject(selectedItem)) return;

      event.preventDefault();
      const step = snapEnabled ? GRID_SIZE : 1;
      const moveStep = event.shiftKey ? step * 10 : step;
      const boundary = resolveLayoutBoundary(layout, currentItems);
      const maxX = Math.max(0, boundary.x + boundary.width - Number(selectedItem.width || 0));
      const maxY = Math.max(0, boundary.y + boundary.height - Number(selectedItem.height || 0));
      const session = beginKeyboardMoveSession(currentItems, selectedItem.id);
      const nextItems = currentItems.map((item) => {
        if (String(item.id) !== String(selectedItem.id)) return item;
        return sanitizeItem({
          ...item,
          x: Math.max(boundary.x, Math.min(maxX, Number(item.x || 0) + delta.x * moveStep)),
          y: Math.max(boundary.y, Math.min(maxY, Number(item.y || 0) + delta.y * moveStep)),
        });
      });
      setDraftItems(nextItems);
      updateDirtyState(nextItems);
      window.clearTimeout(session.timeoutId);
      session.timeoutId = window.setTimeout(commitKeyboardMove, 180);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [beginKeyboardMoveSession, commitKeyboardMove, isLoading, layout, snapEnabled, updateDirtyState]);

  const handleUndo = useCallback(() => {
    const currentHistory = historyRef.current;
    if (currentHistory.past.length === 0) return;
    const previous = currentHistory.past[currentHistory.past.length - 1];
    setHistory((current) => ({
      ...current,
      past: current.past.slice(0, current.past.length - 1),
      future: [cloneItems(draftItemsRef.current), ...current.future],
    }));
    setDraftItems(previous);
    setSelectedObjectId((current) => ensureSelection(previous, current));
    updateDirtyState(previous);
  }, [updateDirtyState]);

  const handleRedo = useCallback(() => {
    const currentHistory = historyRef.current;
    if (currentHistory.future.length === 0) return;
    const next = currentHistory.future[0];
    setHistory((current) => ({
      ...current,
      past: [...current.past, cloneItems(draftItemsRef.current)].slice(-HISTORY_LIMIT),
      future: current.future.slice(1),
    }));
    setDraftItems(next);
    setSelectedObjectId((current) => ensureSelection(next, current));
    updateDirtyState(next);
  }, [updateDirtyState]);

  const handleSelectObject = useCallback((item) => {
    setSelectedObjectId(item?.id || null);
  }, []);

  const handlePreviewItems = useCallback((nextItems) => {
    setDraftItems(nextItems.map(sanitizeItem));
    updateDirtyState(nextItems);
  }, [updateDirtyState]);

  const handleInteractionCommit = useCallback((nextItems, initialItems) => {
    replaceDraftItems(nextItems, {
      commit: true,
      initialItems,
    });
  }, [replaceDraftItems]);

  const handleChangeObject = useCallback((updatedItem, options = {}) => {
    const baseItems = options.itemsSnapshot || draftItemsRef.current;
    const historyBaseItems = options.initialObject
      ? baseItems.map((item) => (
        String(item.id) === String(updatedItem.id)
          ? sanitizeItem(options.initialObject)
          : item
      ))
      : (options.initialItems || baseItems);
    const nextItems = baseItems.map((item) => (
      String(item.id) === String(updatedItem.id)
        ? sanitizeItem(updatedItem)
        : item
    ));
    if (options.commit === false) {
      setDraftItems(nextItems);
      setSelectedObjectId(updatedItem.id);
      updateDirtyState(nextItems);
      return;
    }
    replaceDraftItems(nextItems, {
      commit: true,
      initialItems: historyBaseItems,
      selectedObjectId: updatedItem.id,
    });
  }, [replaceDraftItems, updateDirtyState]);

  const handleDeleteObject = useCallback((itemId) => {
    const initialItems = draftItemsRef.current;
    const nextItems = initialItems.filter((item) => String(item.id) !== String(itemId));
    replaceDraftItems(nextItems, {
      commit: true,
      initialItems,
      selectedObjectId: null,
    });
  }, [replaceDraftItems]);

  const handleAddObject = useCallback((type) => {
    if (type === 'section') {
      setShowSectionCreateModal(true);
      setSectionCreateForm({ name: '', number: '', description: '' });
      setSectionCreateError(null);
      return;
    }

    const currentItems = draftItemsRef.current;
    const viewportCenter = {
      x: (viewportSize.width / 2 - pan.x) / zoom,
      y: (viewportSize.height / 2 - pan.y) / zoom,
    };
    const boundary = resolveLayoutBoundary(layout, currentItems);

    // Auto-link shelf to selected section
    let sectionLink = null;
    if (type === 'shelf' && selectedObjectIdRef.current) {
      const selectedItem = currentItems.find((item) => String(item.id) === String(selectedObjectIdRef.current));
      if (selectedItem && selectedItem.objectType === 'section') {
        const sectionId = selectedItem.sectionId || selectedItem.linkedSectionId
          || selectedItem.properties?.linkedSectionId || selectedItem.metadata?.sectionId || null;
        if (sectionId) {
          sectionLink = {
            sectionId,
            sectionName: selectedItem.label || selectedItem.metadata?.sectionName || '',
            sectionNumber: selectedItem.metadata?.sectionNumber || '',
            nearX: Number(selectedItem.x || 0) + Number(selectedItem.width || 0) + 10,
            nearY: Number(selectedItem.y || 0),
          };
        }
      }
    }

    const newItem = createNewItem({
      type,
      index: currentItems.length,
      viewportCenter: sectionLink ? { x: sectionLink.nearX, y: sectionLink.nearY } : viewportCenter,
      items: currentItems,
      boundary,
    });

    if (sectionLink) {
      newItem.sectionId = sectionLink.sectionId;
      newItem.linkedSectionId = sectionLink.sectionId;
      newItem.metadata = {
        ...(newItem.metadata || {}),
        sectionId: sectionLink.sectionId,
        sectionName: sectionLink.sectionName,
        sectionNumber: sectionLink.sectionNumber,
        shelfSide: 'L',
        shelfNo: '01',
      };
      newItem.properties = {
        ...(newItem.properties || {}),
        linkedSectionId: sectionLink.sectionId,
      };
      newItem.label = `${sectionLink.sectionName || 'Raf'} L-01`;
    }

    const nextItems = [...currentItems, newItem];
    replaceDraftItems(nextItems, {
      commit: true,
      initialItems: currentItems,
      selectedObjectId: newItem.id,
    });
  }, [layout, pan.x, pan.y, replaceDraftItems, viewportSize.height, viewportSize.width, zoom]);

  const handleConfirmSectionCreate = useCallback(async () => {
    const { name, number } = sectionCreateForm;
    if (!name.trim()) {
      setSectionCreateError('Reyon adi zorunludur.');
      return;
    }
    if (!number.trim()) {
      setSectionCreateError('Reyon numarasi zorunludur.');
      return;
    }
    try {
      setSectionCreateLoading(true);
      setSectionCreateError(null);
      const section = await sectionService.create({
        name: name.trim(),
        number: Number(number) || number.trim(),
        description: sectionCreateForm.description.trim() || '',
      });

      // Create layout item linked to the real backend section
      const currentItems = draftItemsRef.current;
      const viewportCenter = {
        x: (viewportSize.width / 2 - pan.x) / zoom,
        y: (viewportSize.height / 2 - pan.y) / zoom,
      };
      const boundary = resolveLayoutBoundary(layout, currentItems);
      const newItem = createNewItem({
        type: 'section',
        index: currentItems.length,
        viewportCenter,
        items: currentItems,
        boundary,
      });

      newItem.label = section.name;
      newItem.sectionId = section.id;
      newItem.linkedSectionId = section.id;
      newItem.metadata = {
        ...(newItem.metadata || {}),
        sectionId: section.id,
        sectionName: section.name,
        sectionNumber: section.number,
      };
      newItem.properties = {
        ...(newItem.properties || {}),
        linkedSectionId: section.id,
        locationCodeSnapshot: `R${String(section.number).padStart(2, '0')}`,
      };
      newItem.locationCodeSnapshot = `R${String(section.number).padStart(2, '0')}`;

      const nextItems = [...currentItems, newItem];
      replaceDraftItems(nextItems, {
        commit: true,
        initialItems: currentItems,
        selectedObjectId: newItem.id,
      });
      setShowSectionCreateModal(false);
    } catch (err) {
      console.error('Reyon olusturma hatasi:', err);
      const realMsg = err.payload?.message || err.payload?.error || err.message;
      setSectionCreateError(realMsg || 'Reyon olusturulamadi.');
    } finally {
      setSectionCreateLoading(false);
    }
  }, [sectionCreateForm, layout, pan.x, pan.y, replaceDraftItems, viewportSize.height, viewportSize.width, zoom]);

  const validateLayout = useCallback(() => {
    const errors = [];
    draftItemsRef.current.forEach((item, index) => {
      if (!item.objectType) {
        errors.push(`Öğe #${index + 1}: Tür boş olamaz.`);
      }
      if (Number(item.x) < 0 || Number(item.y) < 0) {
        errors.push(`"${item.label || 'İsimsiz'}" öğesinin koordinatları negatif olamaz.`);
      }
      if (Number(item.width) <= 0 || Number(item.height) <= 0) {
        errors.push(`"${item.label || 'İsimsiz'}" öğesinin boyutu 0'dan büyük olmalıdır.`);
      }
    });
    return errors;
  }, []);

  const handleSaveDraft = useCallback(async () => {
    const validationErrors = validateLayout();
    if (validationErrors.length > 0) {
      setErrorMsg(validationErrors.join(' '));
      setSaveStatus('error');
      return null;
    }

    try {
      setSaveStatus('saving');
      setErrorMsg(null);

      let draftId = activeLayout?.id;
      let nextActiveLayout = activeLayout;
      if (!draftId) {
        if (layout.id && layout.id !== 'generated') {
          nextActiveLayout = await locationLayoutService.duplicate(layout.id);
        } else {
          nextActiveLayout = await locationLayoutService.create({
            name: 'Varsayilan Sablon Taslagi',
            storeId: layout.storeId,
          });
        }
        draftId = nextActiveLayout.id;
        setActiveLayout(nextActiveLayout);
      }

      const responseLayout = await locationLayoutService.upsertItems(draftId, draftItemsRef.current);
      const updatedItems = responseLayout.items || [];

      setDraftItems(updatedItems);
      setHistory(createHistoryState(updatedItems));
      setSelectedObjectId((current) => ensureSelection(updatedItems, current));
      setIsDirty(false);
      setSaveStatus('idle');
      return draftId;
    } catch (err) {
      setSaveStatus('error');
      const realMsg = err.payload?.message || err.payload?.error || err.message;
      setErrorMsg(realMsg || 'Taslak plan kaydedilirken hata oluştu.');
      return null;
    }
  }, [activeLayout, layout, validateLayout]);

  const handlePublishLayout = useCallback(async () => {
    const draftId = await handleSaveDraft();
    if (!draftId) return;
    try {
      setPublishStatus('publishing');
      setErrorMsg(null);
      const publishedLayout = await locationLayoutService.publish(draftId);
      setPublishStatus('idle');
      onLayoutUpdated(publishedLayout);
    } catch (err) {
      setPublishStatus('error');
      const realMsg = err.payload?.message || err.payload?.error || err.message;
      setErrorMsg(realMsg || 'Plan yayınlanırken bir hata oluştu.');
    }
  }, [handleSaveDraft, onLayoutUpdated]);

  const openExitConfirm = useCallback(() => {
    if (!isDirty) {
      onClose();
      return;
    }
    setPendingExitMode('discard');
  }, [isDirty, onClose]);

  const confirmDiscardExit = useCallback(() => {
    const exitMode = pendingExitMode;
    setPendingExitMode(null);
    setDraftItems(historyRef.current.baseline);
    setHistory((current) => ({ ...current, past: [], future: [] }));
    setSelectedObjectId((current) => ensureSelection(historyRef.current.baseline, current));
    setIsDirty(false);
    if (exitMode === 'route' && blocker.state === 'blocked') {
      blocker.proceed();
      return;
    }
    onClose();
  }, [blocker, onClose, pendingExitMode]);

  const handleSaveAndExit = useCallback(async () => {
    const savedId = await handleSaveDraft();
    if (!savedId) return;
    setPendingExitMode(null);
    onClose();
  }, [handleSaveDraft, onClose]);

  const selectedObject = useMemo(
    () => draftItems.find((item) => String(item.id) === String(selectedObjectId)),
    [draftItems, selectedObjectId]
  );

  return (
    <div className="lm-layout-editor-workspace-root" style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
      <header className="lm-layout-editor-modal-header">
        <div className="lm-layout-editor-header-title">
          <div className="mod-card-icon mod-icon-indigo">
            <Layers size={20} />
          </div>
          <div>
            <h3>Mağaza Planını Düzenle</h3>
            <p>Yerleşimi kontrollü biçimde düzenleyin; görünüm ve nesne düzenleme durumu birbirinden ayrıdır.</p>
          </div>
        </div>
        <button className="lm-layout-editor-close-btn" type="button" onClick={openExitConfirm}>
          <X size={20} />
        </button>
      </header>

      <LocationLayoutToolbar
        zoom={zoom}
        onZoomIn={() => setZoom((value) => Math.min(2.5, value + 0.15))}
        onZoomOut={() => setZoom((value) => Math.max(0.4, value - 0.15))}
        onFit={() => setFitTrigger((value) => value + 1)}
        snapEnabled={snapEnabled}
        onToggleSnap={() => setSnapEnabled((value) => !value)}
        onUndo={handleUndo}
        onRedo={handleRedo}
        canUndo={history.past.length > 0}
        canRedo={history.future.length > 0}
        onSave={handleSaveDraft}
        onPublish={handlePublishLayout}
        onCancel={openExitConfirm}
        isDirty={isDirty}
        saveStatus={saveStatus}
        publishStatus={publishStatus}
        canPublish={canPublish}
      />

      {errorMsg ? (
        <div className="lm-layout-editor-error-strip">
          <AlertCircle size={16} />
          <span>{errorMsg}</span>
        </div>
      ) : null}

      <div className="lm-layout-editor-workspace">
        {isLoading ? (
          <div className="lm-layout-editor-loading">
            <span className="loader"></span>
            <p>Plan taslağı hazırlanıyor...</p>
          </div>
        ) : (
          <>
            <LocationObjectPalette onAddObject={handleAddObject} />

            <div className="lm-layout-canvas-column">
              <LocationLayoutEditableCanvas
                items={draftItems}
                selectedObjectId={selectedObjectId}
                onSelectObject={handleSelectObject}
                onChangeItems={handlePreviewItems}
                onCommitItems={handleInteractionCommit}
                zoom={zoom}
                setZoom={setZoom}
                pan={pan}
                setPan={setPan}
                snapEnabled={snapEnabled}
                gridSize={GRID_SIZE}
                fitTrigger={fitTrigger}
                onViewportMetricsChange={setViewportSize}
              />
            </div>

            <LocationObjectPropertiesPanel
              selectedObject={selectedObject}
              onChangeObject={handleChangeObject}
              onDeleteObject={handleDeleteObject}
            />
          </>
        )}
      </div>

      <ConfirmModal
        isOpen={Boolean(pendingExitMode)}
        title="Kaydedilmemiş değişiklikler var"
        description="Bu sayfadan ayrılırsanız yaptığınız düzenlemeler kaybolacak."
        cancelText="Düzenlemeye Devam Et"
        confirmText="Değişiklikleri İptal Et"
        tone="danger"
        onCancel={() => {
          if (blocker.state === 'blocked') blocker.reset();
          setPendingExitMode(null);
        }}
        onConfirm={confirmDiscardExit}
        thirdAction={{
          label: 'Kaydet ve Çık',
          onClick: handleSaveAndExit,
          disabled: saveStatus === 'saving' || publishStatus === 'publishing',
        }}
        closeButton
      />

      {showSectionCreateModal && (
        <div className="lm-layout-editor-modal-overlay" style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: '16px', padding: '28px', maxWidth: '420px', width: '100%', boxShadow: '0 25px 50px rgba(0,0,0,0.25)' }}>
            <h4 style={{ margin: '0 0 4px 0', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Package size={18} /> Yeni Reyon Oluştur
            </h4>
            <p style={{ margin: '0 0 16px 0', fontSize: '0.78rem', color: '#64748b' }}>
              Reyon bilgilerini girin. Backend'de gerçek Section kaydı oluşturulacaktır.
            </p>
            {sectionCreateError && (
              <div style={{ padding: '8px 12px', borderRadius: '8px', background: '#fef2f2', color: '#dc2626', fontSize: '0.76rem', marginBottom: '12px', border: '1px solid #fecaca' }}>
                {sectionCreateError}
              </div>
            )}
            <label style={{ display: 'block', marginBottom: '10px' }}>
              <span style={{ fontSize: '0.74rem', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '4px' }}>Reyon Adı *</span>
              <input
                type="text"
                value={sectionCreateForm.name}
                onChange={(e) => setSectionCreateForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Örnek: Temel Gıda"
                style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.82rem' }}
                autoFocus
              />
            </label>
            <label style={{ display: 'block', marginBottom: '10px' }}>
              <span style={{ fontSize: '0.74rem', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '4px' }}>Reyon Numarası *</span>
              <input
                type="text"
                value={sectionCreateForm.number}
                onChange={(e) => setSectionCreateForm((f) => ({ ...f, number: e.target.value }))}
                placeholder="Örnek: 3"
                style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.82rem' }}
              />
            </label>
            <label style={{ display: 'block', marginBottom: '16px' }}>
              <span style={{ fontSize: '0.74rem', fontWeight: 600, color: '#334155', display: 'block', marginBottom: '4px' }}>Açıklama (Opsiyonel)</span>
              <input
                type="text"
                value={sectionCreateForm.description}
                onChange={(e) => setSectionCreateForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Kısa açıklama..."
                style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.82rem' }}
              />
            </label>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="secondary-button"
                onClick={() => setShowSectionCreateModal(false)}
                disabled={sectionCreateLoading}
                style={{ padding: '8px 16px', fontSize: '0.78rem' }}
              >
                Vazgeç
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={handleConfirmSectionCreate}
                disabled={sectionCreateLoading}
                style={{ padding: '8px 16px', fontSize: '0.78rem' }}
              >
                {sectionCreateLoading ? 'Oluşturuluyor...' : 'Reyon Oluştur'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
