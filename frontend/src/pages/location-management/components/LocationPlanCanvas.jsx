import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Search } from 'lucide-react';
import LocationPlanObject, { isSelectablePlanObject } from './LocationPlanObject.jsx';

const DEFAULT_BOUNDS = { minX: 0, maxX: 1200, minY: 0, maxY: 800 };

const RENDER_ORDER = {
  'aisle': 1,
  'empty_area': 1,
  'wall': 1,
  'zone': 1,
  'section': 2,
  'shelf': 3,
  'warehouse_location': 3,
  'section_common_area': 4,
  'warehouse_common_area': 4,
  'cashier': 5,
  'entrance': 5,
  'exit': 5,
  'warehouse_door': 5,
  'service_area': 5,
  'label': 5
};

const getSortOrder = (objectType) => {
  return RENDER_ORDER[objectType] || 99;
};

export const getPlanDetailLevel = (zoom) => {
  if (zoom < 0.75) return 'overview';
  if (zoom > 1.25) return 'detail';
  return 'standard';
};

export const calculateLayoutBounds = (items = []) => {
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

export const includeBoundaryInBounds = (bounds, boundary) => {
  const boundaries = Array.isArray(boundary) ? boundary : boundary ? [boundary] : [];
  return boundaries.reduce((nextBounds, current) => ({
    minX: Math.min(nextBounds.minX, Number(current.x || 0)),
    maxX: Math.max(nextBounds.maxX, Number(current.x || 0) + Number(current.width || 0)),
    minY: Math.min(nextBounds.minY, Number(current.y || 0)),
    maxY: Math.max(nextBounds.maxY, Number(current.y || 0) + Number(current.height || 0)),
  }), bounds);
};

export const getRotatedBounds = (bounds, rotation = 0) => {
  const normalized = ((Number(rotation) % 360) + 360) % 360;
  if (normalized !== 90 && normalized !== 270) return bounds;
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  return {
    minX: centerX - height / 2,
    maxX: centerX + height / 2,
    minY: centerY - width / 2,
    maxY: centerY + width / 2,
  };
};

export const rotatePoint = (point, center, rotation = 0) => {
  const radians = (Number(rotation) * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const deltaX = point.x - center.x;
  const deltaY = point.y - center.y;
  return {
    x: center.x + deltaX * cosine - deltaY * sine,
    y: center.y + deltaX * sine + deltaY * cosine,
  };
};

export default function LocationPlanCanvas({
  items = [],
  selectedObjectId = null,
  highlightedObjectId = null,
  onSelectObject = () => {},
  zoom = 1,
  setZoom = () => {},
  pan = { x: 0, y: 0 },
  setPan = () => {},
  visibleTypes = new Set(),
  fitTrigger = 0,
  rotation = 0,
  boundaries = [],
  showBoundaries = false,
}) {
  const canvasRef = useRef(null);
  const wrapperRef = useRef(null);
  const contentRef = useRef(null);
  const badgeValueRef = useRef(null);
  const zoomRef = useRef(zoom);
  const panRef = useRef(pan);
  const frameRef = useRef(0);
  const pendingViewRef = useRef(null);
  const wheelCommitTimerRef = useRef(0);
  const hasInitialFitRef = useRef(false);
  const dragRef = useRef({
    active: false,
    moved: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    panX: 0,
    panY: 0,
  });
  const suppressClickRef = useRef(false);
  const suppressClickTimerRef = useRef(0);
  const pendingSelectionRef = useRef({ item: null, isBackground: false });

  const resolvePointerItem = useCallback((target) => {
    const hitElement = target?.closest?.('.lm-plan-object:not(.is-decorative)');
    if (!hitElement) return null;
    const objectId = hitElement.getAttribute('data-object-id');
    if (!objectId) return null;
    return items.find(
      (candidate) => String(candidate.id) === objectId && isSelectablePlanObject(candidate)
    ) || null;
  }, [items]);

  const unrotatedBounds = useMemo(
    () => includeBoundaryInBounds(calculateLayoutBounds(items), boundaries),
    [boundaries, items]
  );
  const bounds = useMemo(
    () => getRotatedBounds(unrotatedBounds, rotation),
    [rotation, unrotatedBounds]
  );
  const rotationCenter = useMemo(() => ({
    x: (unrotatedBounds.minX + unrotatedBounds.maxX) / 2,
    y: (unrotatedBounds.minY + unrotatedBounds.maxY) / 2,
  }), [unrotatedBounds]);
  const filteredItems = useMemo(
    () => items.filter(
      (item) => visibleTypes.size === 0 || visibleTypes.has(item.objectType) || item.id === highlightedObjectId
    ),
    [highlightedObjectId, items, visibleTypes]
  );

  const sortedItems = useMemo(() => {
    return [...filteredItems].sort((a, b) => getSortOrder(a.objectType) - getSortOrder(b.objectType));
  }, [filteredItems]);
  const selectedObjectIdText = selectedObjectId == null ? '' : String(selectedObjectId);
  const highlightedObjectIdText = highlightedObjectId == null ? '' : String(highlightedObjectId);

  const detailLevel = getPlanDetailLevel(zoom);

  const clampPan = useCallback((x, y, currentZoom) => {
    const wrapper = wrapperRef.current;
    const containerWidth = wrapper ? wrapper.clientWidth : 800;
    const containerHeight = wrapper ? wrapper.clientHeight : 800;

    const padding = 150;
    const minPanX = padding - (bounds.maxX * currentZoom);
    const maxPanX = containerWidth - padding - (bounds.minX * currentZoom);
    const minPanY = padding - (bounds.maxY * currentZoom);
    const maxPanY = containerHeight - padding - (bounds.minY * currentZoom);

    const clampedX = minPanX <= maxPanX ? Math.max(minPanX, Math.min(maxPanX, x)) : (minPanX + maxPanX) / 2;
    const clampedY = minPanY <= maxPanY ? Math.max(minPanY, Math.min(maxPanY, y)) : (minPanY + maxPanY) / 2;

    return { x: clampedX, y: clampedY };
  }, [bounds]);

  const fitToScreen = useCallback(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || !items.length) return;

    const containerWidth = wrapper.clientWidth;
    const containerHeight = wrapper.clientHeight;

    const contentWidth = bounds.maxX - bounds.minX;
    const contentHeight = bounds.maxY - bounds.minY;

    if (contentWidth <= 0 || contentHeight <= 0) return;

    const padding = 50;
    const targetWidth = containerWidth - padding * 2;
    const targetHeight = containerHeight - padding * 2;

    let nextZoom = Math.min(targetWidth / contentWidth, targetHeight / contentHeight);
    nextZoom = Math.min(2.5, Math.max(0.4, nextZoom));

    const contentCenterX = bounds.minX + contentWidth / 2;
    const contentCenterY = bounds.minY + contentHeight / 2;

    const containerCenterX = containerWidth / 2;
    const containerCenterY = containerHeight / 2;

    const panX = containerCenterX - contentCenterX * nextZoom;
    const panY = containerCenterY - contentCenterY * nextZoom;

    const clamped = clampPan(panX, panY, nextZoom);

    setZoom(nextZoom);
    setPan(clamped);
  }, [items, bounds, clampPan, setZoom, setPan]);

  useEffect(() => {
    if (hasInitialFitRef.current || !items.length) return undefined;
    const timer = setTimeout(() => {
      fitToScreen();
      hasInitialFitRef.current = true;
    }, 100);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  useEffect(() => {
    if (fitTrigger > 0) {
      fitToScreen();
    }
  }, [fitTrigger, fitToScreen]);

  useEffect(() => {
    if (!highlightedObjectId) return;
    const wrapper = wrapperRef.current;
    const item = items.find((candidate) => candidate.id === highlightedObjectId);
    if (!wrapper || !item) return;
    const itemCenter = rotatePoint({
      x: Number(item.x || 0) + Number(item.width || 0) / 2,
      y: Number(item.y || 0) + Number(item.height || 0) / 2,
    }, rotationCenter, rotation);
    const nextZoom = 1.3;
    const nextPan = clampPan(
      wrapper.clientWidth / 2 - itemCenter.x * nextZoom,
      wrapper.clientHeight / 2 - itemCenter.y * nextZoom,
      nextZoom
    );
    setZoom(nextZoom);
    setPan(nextPan);
  }, [
    clampPan,
    highlightedObjectId,
    items,
    rotation,
    rotationCenter,
    setPan,
    setZoom,
  ]);

  const applyView = useCallback((nextZoom, nextPan) => {
    zoomRef.current = nextZoom;
    panRef.current = nextPan;
    contentRef.current?.setAttribute('transform', `translate(${nextPan.x}, ${nextPan.y}) scale(${nextZoom})`);
    if (badgeValueRef.current) badgeValueRef.current.textContent = `${Math.round(nextZoom * 100)}%`;
  }, []);

  const scheduleView = useCallback((nextZoom, nextPan) => {
    pendingViewRef.current = { zoom: nextZoom, pan: nextPan };
    if (frameRef.current) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = 0;
      const pending = pendingViewRef.current;
      pendingViewRef.current = null;
      if (pending) applyView(pending.zoom, pending.pan);
    });
  }, [applyView]);

  const commitView = useCallback(() => {
    if (pendingViewRef.current) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
      const pending = pendingViewRef.current;
      pendingViewRef.current = null;
      applyView(pending.zoom, pending.pan);
    }
    const nextZoom = zoomRef.current;
    const nextPan = panRef.current;
    setZoom((current) => (current === nextZoom ? current : nextZoom));
    setPan((current) => (
      current.x === nextPan.x && current.y === nextPan.y ? current : nextPan
    ));
  }, [applyView, setPan, setZoom]);

  useEffect(() => {
    if (!dragRef.current.active && !wheelCommitTimerRef.current) {
      applyView(zoom, pan);
    }
  }, [applyView, pan, zoom]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const handleWheel = (e) => {
      e.preventDefault();

      const rect = wrapper.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const delta = -e.deltaY;
      const scaleFactor = 0.0008;
      
      const currentZoom = zoomRef.current;
      const currentPan = panRef.current;

      let newZoom = currentZoom + delta * scaleFactor;
      newZoom = Math.min(2.5, Math.max(0.4, newZoom));

      if (newZoom !== currentZoom) {
        const ratio = newZoom / currentZoom;
        const newPanX = mouseX - ratio * (mouseX - currentPan.x);
        const newPanY = mouseY - ratio * (mouseY - currentPan.y);
        const clamped = clampPan(newPanX, newPanY, newZoom);
        scheduleView(newZoom, clamped);
        window.clearTimeout(wheelCommitTimerRef.current);
        wheelCommitTimerRef.current = window.setTimeout(() => {
          wheelCommitTimerRef.current = 0;
          commitView();
        }, 120);
      }
    };

    wrapper.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      wrapper.removeEventListener('wheel', handleWheel);
      window.clearTimeout(wheelCommitTimerRef.current);
    };
  }, [clampPan, commitView, scheduleView]);

  const handlePointerDown = (e) => {
    const button = Number.isFinite(e.button) ? e.button : 0;
    if (button !== 0 && button !== 1) return;
    if (e.isPrimary === false) return;
    if (button === 1) e.preventDefault();
    const pointerItem = resolvePointerItem(e.target);
    pendingSelectionRef.current = {
      item: pointerItem,
      isBackground: !pointerItem,
    };
    dragRef.current = {
      active: true,
      moved: false,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      panX: panRef.current.x,
      panY: panRef.current.y,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    wrapperRef.current?.classList.add('is-dragging');
  };

  const handlePointerMove = (e) => {
    const drag = dragRef.current;
    if (!drag.active || drag.pointerId !== e.pointerId) return;
    const deltaX = e.clientX - drag.startX;
    const deltaY = e.clientY - drag.startY;
    if (!drag.moved && Math.hypot(deltaX, deltaY) < 5) return;
    drag.moved = true;
    wrapperRef.current?.classList.add('is-panning');
    const clamped = clampPan(drag.panX + deltaX, drag.panY + deltaY, zoomRef.current);
    scheduleView(zoomRef.current, clamped);
  };

  const finishPointerInteraction = (e) => {
    const drag = dragRef.current;
    if (!drag.active || (e?.pointerId != null && drag.pointerId !== e.pointerId)) return;
    const pendingSelection = pendingSelectionRef.current;
    const didPan = drag.moved;
    suppressClickRef.current = didPan;
    if (!didPan) {
      if (pendingSelection.item) {
        onSelectObject(pendingSelection.item);
        suppressClickRef.current = true;
      } else if (pendingSelection.isBackground) {
        onSelectObject(null);
        suppressClickRef.current = true;
      }
    }
    pendingSelectionRef.current = { item: null, isBackground: false };
    window.clearTimeout(suppressClickTimerRef.current);
    suppressClickTimerRef.current = window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
    if (e?.currentTarget?.hasPointerCapture?.(drag.pointerId)) {
      e.currentTarget.releasePointerCapture(drag.pointerId);
    }
    dragRef.current.active = false;
    dragRef.current.pointerId = null;
    dragRef.current.moved = false;
    wrapperRef.current?.classList.remove('is-dragging');
    wrapperRef.current?.classList.remove('is-panning');
    commitView();
  };

  useEffect(() => () => {
    window.cancelAnimationFrame(frameRef.current);
    window.clearTimeout(wheelCommitTimerRef.current);
    window.clearTimeout(suppressClickTimerRef.current);
  }, []);

  const handleObjectClick = useCallback((item) => {
    if (!isSelectablePlanObject(item)) return;
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onSelectObject(item);
  }, [onSelectObject]);

  return (
    <div
      ref={wrapperRef}
      className="lm-plan-canvas-wrapper"
      style={{
        width: '100%',
        overflow: 'hidden',
        position: 'relative',
        userSelect: 'none',
        touchAction: 'none',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={finishPointerInteraction}
      onPointerCancel={finishPointerInteraction}
    >
      <svg
        ref={canvasRef}
        width="100%"
        height="100%"
        style={{ display: 'block' }}
        onClick={(event) => {
          if (suppressClickRef.current) {
            suppressClickRef.current = false;
            return;
          }
          if (event.target !== event.currentTarget) return;
          onSelectObject(null);
        }}
      >
        <defs>
          <linearGradient id="planSurfaceGradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#172554" stopOpacity="0.28" />
            <stop offset="48%" stopColor="#0f172a" stopOpacity="0.08" />
            <stop offset="100%" stopColor="#312e81" stopOpacity="0.24" />
          </linearGradient>
          <radialGradient id="planGlowTop" cx="0" cy="0" r="1">
            <stop offset="0%" stopColor="#60a5fa" stopOpacity="0.24" />
            <stop offset="65%" stopColor="#2563eb" stopOpacity="0.04" />
            <stop offset="100%" stopColor="#2563eb" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="planGlowBottom" cx="1" cy="1" r="1">
            <stop offset="0%" stopColor="#a78bfa" stopOpacity="0.2" />
            <stop offset="68%" stopColor="#7c3aed" stopOpacity="0.03" />
            <stop offset="100%" stopColor="#7c3aed" stopOpacity="0" />
          </radialGradient>
          <pattern
            id="gridPattern"
            width="40"
            height="40"
            patternUnits="userSpaceOnUse"
          >
            {/* Minor grid lines */}
            <path
              d="M 10 0 L 10 40 M 20 0 L 20 40 M 30 0 L 30 40 M 0 10 L 40 10 M 0 20 L 40 20 M 0 30 L 40 30"
              fill="none"
              stroke="rgba(191, 219, 254, 0.035)"
              strokeWidth="0.5"
            />
            {/* Major grid lines */}
            <path
              d="M 40 0 L 0 0 0 40"
              fill="none"
              stroke="rgba(191, 219, 254, 0.075)"
              strokeWidth="0.8"
            />
          </pattern>
        </defs>

        <rect width="100%" height="100%" fill="url(#planSurfaceGradient)" pointerEvents="none" />
        <rect width="72%" height="72%" fill="url(#planGlowTop)" pointerEvents="none" />
        <rect x="28%" y="28%" width="72%" height="72%" fill="url(#planGlowBottom)" pointerEvents="none" />
        <rect
          width="100%"
          height="100%"
          fill="url(#gridPattern)"
          pointerEvents="none"
        />

        <g ref={contentRef} transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
          <g transform={`rotate(${rotation}, ${rotationCenter.x}, ${rotationCenter.y})`}>
            {showBoundaries && boundaries.map((boundary, index) => (
              <g
                key={`${boundary.type || 'boundary'}-${index}`}
                className={`lm-plan-boundary lm-plan-boundary--${boundary.type || 'secondary'}`}
                pointerEvents="none"
              >
                <rect
                  x={boundary.x}
                  y={boundary.y}
                  width={boundary.width}
                  height={boundary.height}
                  rx="18"
                  ry="18"
                />
                <text x={boundary.x + 18} y={boundary.y + 28}>
                  {boundary.label || 'Alan Sınırı'}
                </text>
              </g>
            ))}
            {/* Main items layer */}
            {sortedItems.map((item) => {
              const isSelectable = isSelectablePlanObject(item);
              return (
                <LocationPlanObject
                  key={item.id}
                  item={item}
                  isSelected={isSelectable && selectedObjectIdText === String(item.id)}
                  isHighlighted={isSelectable && highlightedObjectIdText === String(item.id)}
                  onClick={handleObjectClick}
                  detailLevel={detailLevel}
                  stopMouseDownPropagation={false}
                />
              );
            })}
            {/* Overlay border layer for selection and highlights (on top of everything) */}
            {sortedItems
              .filter((item) => (
                isSelectablePlanObject(item)
                && (String(item.id) === selectedObjectIdText || String(item.id) === highlightedObjectIdText)
              ))
              .map((item) => (
                <LocationPlanObject
                  key={`overlay-${item.id}`}
                  item={item}
                  isSelected={selectedObjectIdText === String(item.id)}
                  isHighlighted={highlightedObjectIdText === String(item.id)}
                  onClick={handleObjectClick}
                  detailLevel={detailLevel}
                  isOverlayOnly={true}
                />
              ))}
          </g>
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
        <span ref={badgeValueRef}>{Math.round(zoom * 100)}%</span>
      </div>
    </div>
  );
}
