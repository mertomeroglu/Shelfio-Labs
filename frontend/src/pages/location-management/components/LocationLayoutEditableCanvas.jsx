import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Search } from 'lucide-react';
import LocationPlanObject from './LocationPlanObject.jsx';
import { isLayoutItemUserLocked } from '../../../services/locationLayoutService.js';

const DEFAULT_BOUNDS = { minX: 0, maxX: 1200, minY: 0, maxY: 800 };
const NOOP = () => {};

const RENDER_ORDER = {
  aisle: 1,
  empty_area: 1,
  wall: 1,
  zone: 1,
  section: 2,
  shelf: 3,
  warehouse_location: 3,
  section_common_area: 4,
  warehouse_common_area: 4,
  cashier: 5,
  entrance: 5,
  exit: 5,
  warehouse_door: 5,
  service_area: 5,
  label: 5,
};

const getSortOrder = (objectType) => RENDER_ORDER[objectType] || 99;
const isEditable = (item) => (
  !isLayoutItemUserLocked(item)
  || item.objectType === 'section_common_area'
  || item.objectType === 'warehouse_common_area'
);

const calculateBounds = (items) => {
  if (!items.length) return DEFAULT_BOUNDS;
  return items.reduce((bounds, item) => ({
    minX: Math.min(bounds.minX, Number(item.x || 0)),
    maxX: Math.max(bounds.maxX, Number(item.x || 0) + Number(item.width || 0)),
    minY: Math.min(bounds.minY, Number(item.y || 0)),
    maxY: Math.max(bounds.maxY, Number(item.y || 0) + Number(item.height || 0)),
  }), {
    minX: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  });
};

export const updateInteractiveItem = ({
  items,
  interaction,
  clientX,
  clientY,
  zoom,
  snapEnabled,
  gridSize,
}) => {
  if (!interaction || (interaction.type !== 'dragging' && interaction.type !== 'resizing')) {
    return items;
  }
  const dx = (clientX - interaction.startX) / zoom;
  const dy = (clientY - interaction.startY) / zoom;

  return items.map((item) => {
    if (item.id !== interaction.itemId) return item;
    if (interaction.type === 'dragging') {
      let x = interaction.initialItemX + dx;
      let y = interaction.initialItemY + dy;
      if (snapEnabled) {
        x = Math.round(x / gridSize) * gridSize;
        y = Math.round(y / gridSize) * gridSize;
      }
      return { ...item, x: Math.max(0, x), y: Math.max(0, y) };
    }

    let width = interaction.initialItemW + dx;
    let height = interaction.initialItemH + dy;
    if (snapEnabled) {
      width = Math.round(width / gridSize) * gridSize;
      height = Math.round(height / gridSize) * gridSize;
    }
    return { ...item, width: Math.max(10, width), height: Math.max(10, height) };
  });
};

export default function LocationLayoutEditableCanvas({
  items = [],
  selectedObjectId = null,
  onSelectObject = NOOP,
  onChangeItems = NOOP,
  onCommitItems = null,
  zoom = 1,
  setZoom = NOOP,
  pan = { x: 0, y: 0 },
  setPan = NOOP,
  snapEnabled = true,
  gridSize = 10,
  fitTrigger = 0,
  onViewportMetricsChange = NOOP,
}) {
  const wrapperRef = useRef(null);
  const interactionRef = useRef(null);
  const previewItemsRef = useRef(items);
  const pendingPointerRef = useRef(null);
  const frameRef = useRef(0);
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  const hasAutoFitRef = useRef(false);
  const [interactionType, setInteractionType] = useState(null);

  const bounds = useMemo(() => calculateBounds(items), [items]);
  const sortedItems = useMemo(
    () => [...items].sort((a, b) => getSortOrder(a.objectType) - getSortOrder(b.objectType)),
    [items]
  );
  const detailLevel = zoom < 0.75 ? 'overview' : zoom > 1.25 ? 'detail' : 'standard';
  const renderedItems = useMemo(() => sortedItems.map((item) => {
    const isSelected = String(selectedObjectId || '') === String(item.id);
    return { item, isSelected };
  }), [selectedObjectId, sortedItems]);

  useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  useEffect(() => {
    panRef.current = pan;
  }, [pan]);

  useEffect(() => {
    if (!interactionRef.current) previewItemsRef.current = items;
  }, [items]);

  const clampPan = useCallback((x, y, currentZoom) => {
    const wrapper = wrapperRef.current;
    const containerWidth = wrapper?.clientWidth || 800;
    const containerHeight = wrapper?.clientHeight || 600;
    const padding = 100;
    const minPanX = padding - bounds.maxX * currentZoom;
    const maxPanX = containerWidth - padding - bounds.minX * currentZoom;
    const minPanY = padding - bounds.maxY * currentZoom;
    const maxPanY = containerHeight - padding - bounds.minY * currentZoom;
    return {
      x: minPanX <= maxPanX
        ? Math.max(minPanX, Math.min(maxPanX, x))
        : (minPanX + maxPanX) / 2,
      y: minPanY <= maxPanY
        ? Math.max(minPanY, Math.min(maxPanY, y))
        : (minPanY + maxPanY) / 2,
    };
  }, [bounds]);

  const fitToScreen = useCallback(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || !items.length) return;
    const contentWidth = bounds.maxX - bounds.minX;
    const contentHeight = bounds.maxY - bounds.minY;
    if (contentWidth <= 0 || contentHeight <= 0) return;

    const padding = 50;
    const nextZoom = Math.min(2.5, Math.max(
      0.4,
      Math.min(
        (wrapper.clientWidth - padding * 2) / contentWidth,
        (wrapper.clientHeight - padding * 2) / contentHeight
      )
    ));
    const nextPan = clampPan(
      wrapper.clientWidth / 2 - (bounds.minX + contentWidth / 2) * nextZoom,
      wrapper.clientHeight / 2 - (bounds.minY + contentHeight / 2) * nextZoom,
      nextZoom
    );
    setZoom(nextZoom);
    setPan(nextPan);
  }, [bounds, clampPan, items.length, setPan, setZoom]);

  useEffect(() => {
    if (hasAutoFitRef.current || !items.length) return undefined;
    const timer = window.setTimeout(() => {
      fitToScreen();
      hasAutoFitRef.current = true;
    }, 100);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  useEffect(() => {
    if (fitTrigger > 0) fitToScreen();
  }, [fitToScreen, fitTrigger]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return undefined;

    const updateMetrics = () => {
      onViewportMetricsChange({
        width: wrapper.clientWidth || 0,
        height: wrapper.clientHeight || 0,
      });
    };

    updateMetrics();
    window.addEventListener('resize', updateMetrics);
    return () => window.removeEventListener('resize', updateMetrics);
  }, [onViewportMetricsChange]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return undefined;
    const handleWheel = (event) => {
      event.preventDefault();
      const currentZoom = zoomRef.current;
      const currentPan = panRef.current;
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        const nextPan = clampPan(
          currentPan.x - event.deltaX,
          currentPan.y,
          currentZoom
        );
        panRef.current = nextPan;
        setPan(nextPan);
        return;
      }
      const rect = wrapper.getBoundingClientRect();
      const mouseX = event.clientX - rect.left;
      const mouseY = event.clientY - rect.top;
      const nextZoom = Math.min(2.5, Math.max(0.4, currentZoom - event.deltaY * 0.0008));
      if (nextZoom === currentZoom) return;
      const ratio = nextZoom / currentZoom;
      const nextPan = clampPan(
        mouseX - ratio * (mouseX - currentPan.x),
        mouseY - ratio * (mouseY - currentPan.y),
        nextZoom
      );
      zoomRef.current = nextZoom;
      panRef.current = nextPan;
      setZoom(nextZoom);
      setPan(nextPan);
    };
    wrapper.addEventListener('wheel', handleWheel, { passive: false });
    return () => wrapper.removeEventListener('wheel', handleWheel);
  }, [clampPan, setPan, setZoom]);

  const applyPendingPointer = useCallback(() => {
    frameRef.current = 0;
    const interaction = interactionRef.current;
    const pointer = pendingPointerRef.current;
    pendingPointerRef.current = null;
    if (!interaction || !pointer) return;

    if (interaction.type === 'panning') {
      const nextPan = clampPan(
        interaction.initialPanX + pointer.clientX - interaction.startX,
        interaction.initialPanY + pointer.clientY - interaction.startY,
        zoomRef.current
      );
      panRef.current = nextPan;
      setPan(nextPan);
      return;
    }

    const nextItems = updateInteractiveItem({
      items: interaction.initialItems,
      interaction,
      clientX: pointer.clientX,
      clientY: pointer.clientY,
      zoom: zoomRef.current,
      snapEnabled,
      gridSize,
    });
    previewItemsRef.current = nextItems;
    onChangeItems(nextItems);
  }, [clampPan, gridSize, onChangeItems, setPan, snapEnabled]);

  const schedulePointer = useCallback((clientX, clientY) => {
    pendingPointerRef.current = { clientX, clientY };
    if (!frameRef.current) {
      frameRef.current = window.requestAnimationFrame(applyPendingPointer);
    }
  }, [applyPendingPointer]);

  const beginInteraction = useCallback((event, nextInteraction) => {
    interactionRef.current = nextInteraction;
    previewItemsRef.current = nextInteraction.initialItems || items;
    setInteractionType(nextInteraction.type);
    event.currentTarget.ownerSVGElement?.setPointerCapture?.(event.pointerId);
  }, [items]);

  const handleCanvasPointerDown = useCallback((event) => {
    if (event.button !== 0) return;
    if (event.target.tagName !== 'svg' && event.target.id !== 'canvasBg') return;
    onSelectObject(null);
    interactionRef.current = {
      type: 'panning',
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      initialPanX: panRef.current.x,
      initialPanY: panRef.current.y,
    };
    setInteractionType('panning');
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, [onSelectObject]);

  const handleObjectPointerDown = useCallback((event, item) => {
    event.stopPropagation();
    if (event.button !== 0) return;
    onSelectObject(item);
    if (!isEditable(item)) return;
    beginInteraction(event, {
      type: 'dragging',
      pointerId: event.pointerId,
      itemId: item.id,
      startX: event.clientX,
      startY: event.clientY,
      initialItemX: item.x,
      initialItemY: item.y,
      initialItems: items,
    });
  }, [beginInteraction, items, onSelectObject]);

  const handleResizePointerDown = useCallback((event, item) => {
    event.stopPropagation();
    if (event.button !== 0 || !isEditable(item)) return;
    beginInteraction(event, {
      type: 'resizing',
      pointerId: event.pointerId,
      itemId: item.id,
      startX: event.clientX,
      startY: event.clientY,
      initialItemW: item.width,
      initialItemH: item.height,
      initialItems: items,
    });
  }, [beginInteraction, items]);

  const handlePointerMove = useCallback((event) => {
    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    schedulePointer(event.clientX, event.clientY);
  }, [schedulePointer]);

  const finishInteraction = useCallback((event) => {
    const interaction = interactionRef.current;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    if (pendingPointerRef.current) {
      window.cancelAnimationFrame(frameRef.current);
      applyPendingPointer();
    }
    if (
      interaction.type !== 'panning'
      && previewItemsRef.current !== interaction.initialItems
      && onCommitItems
    ) {
      onCommitItems(previewItemsRef.current, interaction.initialItems);
    }
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    interactionRef.current = null;
    pendingPointerRef.current = null;
    setInteractionType(null);
  }, [applyPendingPointer, onCommitItems]);

  useEffect(() => () => window.cancelAnimationFrame(frameRef.current), []);

  const commitDiscreteChange = useCallback((nextItems) => {
    if (onCommitItems) onCommitItems(nextItems, items);
    else onChangeItems(nextItems);
  }, [items, onChangeItems, onCommitItems]);

  const handleRotateClick = useCallback((event, item) => {
    event.stopPropagation();
    if (!isEditable(item)) return;
    const updatedItem = { ...item, rotation: ((item.rotation || 0) + 90) % 360 };
    commitDiscreteChange(items.map((candidate) => candidate.id === item.id ? updatedItem : candidate));
    onSelectObject(updatedItem);
  }, [commitDiscreteChange, items, onSelectObject]);

  const handleDeleteClick = useCallback((event, item) => {
    event.stopPropagation();
    commitDiscreteChange(items.filter((candidate) => candidate.id !== item.id));
    onSelectObject(null);
  }, [commitDiscreteChange, items, onSelectObject]);

  return (
    <div
      ref={wrapperRef}
      className={`lm-layout-canvas-wrapper ${interactionType ? 'is-interacting' : ''} ${interactionType === 'panning' ? 'is-panning' : ''}`}
      style={{
        width: '100%',
        height: '100%',
        minHeight: '400px',
        overflow: 'hidden',
        position: 'relative',
        background: '#0b0f19',
        border: '2px solid #1e293b',
        borderRadius: '16px',
        cursor: interactionType === 'panning' ? 'grabbing' : 'grab',
        userSelect: 'none',
        touchAction: 'none',
        overscrollBehavior: 'contain',
        boxShadow: 'inset 0 4px 20px rgba(0, 0, 0, 0.35)',
      }}
      onPointerDown={handleCanvasPointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishInteraction}
      onPointerCancel={finishInteraction}
    >
      <svg width="100%" height="100%" style={{ display: 'block' }}>
        <defs>
          <pattern
            id="gridPatternEdit"
            width={gridSize * 4}
            height={gridSize * 4}
            patternUnits="userSpaceOnUse"
          >
            <path
              d={`M ${gridSize * 4} 0 L 0 0 0 ${gridSize * 4}`}
              fill="none"
              stroke="rgba(6, 182, 212, 0.12)"
              strokeWidth="1.2"
            />
            <path
              d={`M ${gridSize} 0 L 0 0 0 ${gridSize}`}
              fill="none"
              stroke="rgba(6, 182, 212, 0.04)"
              strokeWidth="0.8"
            />
          </pattern>
        </defs>

        <rect id="canvasBg" width="100%" height="100%" fill="url(#gridPatternEdit)" />

        <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
          {renderedItems.map(({ item, isSelected }) => {
            return (
              <g key={item.id}>
                <g onPointerDown={(event) => handleObjectPointerDown(event, item)}>
                  <LocationPlanObject
                    item={item}
                    isSelected={isSelected}
                    onClick={NOOP}
                    detailLevel={detailLevel}
                    stopMouseDownPropagation={false}
                  />
                </g>

                {isSelected && (
                  <g transform={`translate(${item.x}, ${item.y}) rotate(${item.rotation || 0}, ${item.width / 2}, ${item.height / 2})`}>
                    <rect
                      x={-4}
                      y={-4}
                      width={item.width + 8}
                      height={item.height + 8}
                      fill="none"
                      stroke="#38bdf8"
                      strokeWidth="1.5"
                      strokeDasharray="4,3"
                      pointerEvents="none"
                    />

                    {isEditable(item) && (
                      <circle
                        cx={item.width}
                        cy={item.height}
                        r={6}
                        fill="#ffffff"
                        stroke="#38bdf8"
                        strokeWidth="2"
                        style={{ cursor: 'se-resize' }}
                        onPointerDown={(event) => handleResizePointerDown(event, item)}
                      />
                    )}

                    <g transform={`translate(${item.width / 2 - 24}, -24)`}>
                      {!isLayoutItemUserLocked(item)
                        && item.objectType !== 'section_common_area'
                        && item.objectType !== 'warehouse_common_area' && (
                          <g
                            style={{ cursor: 'pointer' }}
                            onClick={(event) => handleRotateClick(event, item)}
                          >
                            <title>90 Derece Döndür</title>
                            <circle cx={10} cy={10} r={10} fill="#0f172a" />
                            <g transform="translate(4,4) scale(0.5)">
                              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" stroke="#ffffff" strokeWidth="3" fill="none" />
                            </g>
                          </g>
                        )}

                      {!isLayoutItemUserLocked(item)
                        && item.objectType !== 'section_common_area'
                        && item.objectType !== 'warehouse_common_area' && (
                          <g
                            style={{ cursor: 'pointer' }}
                            onClick={(event) => handleDeleteClick(event, item)}
                          >
                            <title>Plandan Sil</title>
                            <circle cx={34} cy={10} r={10} fill="#ef4444" />
                            <g transform="translate(29,5) scale(0.45)">
                              <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" stroke="#ffffff" strokeWidth="3" fill="none" />
                            </g>
                          </g>
                        )}
                    </g>
                  </g>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      <div
        className="lm-plan-canvas-scale-badge"
        style={{
          position: 'absolute',
          bottom: '14px',
          right: '14px',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          pointerEvents: 'none',
        }}
      >
        <Search size={13} strokeWidth={2.5} style={{ color: '#38bdf8' }} />
        <span>{Math.round(zoom * 100)}%</span>
        <span style={{ opacity: 0.3, margin: '0 2px' }}>|</span>
        <span style={{ fontSize: '0.68rem', letterSpacing: '0.05em' }}>
          SNAP: {snapEnabled ? 'ON' : 'OFF'}
        </span>
      </div>
    </div>
  );
}
