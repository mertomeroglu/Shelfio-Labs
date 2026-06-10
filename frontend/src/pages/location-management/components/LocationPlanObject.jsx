import React, { memo } from 'react';
import { Package, Inbox, Warehouse, LogIn, LogOut, ShoppingCart, MoveHorizontal, MapPin, Snowflake, Star, Wrench, Square, Settings, Layers } from 'lucide-react';

const TYPE_STYLES = {
  section: {
    color: '#FDE68A',
    stroke: '#B45309',
    Icon: Package,
    label: 'Reyon'
  },
  section_common_area: {
    color: '#E8EDF5',
    stroke: '#4B6B9E',
    Icon: Layers,
    label: 'Ortak Reyon Alanı',
  },
  warehouse_common_area: {
    color: '#E5F2EF',
    stroke: '#2F7A6E',
    Icon: Warehouse,
    label: 'Ortak Depo Alanı',
  },
  shelf: {
    color: '#F1F5F9',
    stroke: '#64748B',
    Icon: Inbox,
    label: 'Raf',
    strokeDasharray: '2,2'
  },
  shelf_stack: {
    color: '#F1F5F9',
    stroke: '#64748B',
    Icon: Inbox,
    label: 'Raf',
    strokeDasharray: '2,2'
  },
  warehouse_location: {
    color: '#D9F99D',
    stroke: '#3F6212',
    Icon: Warehouse,
    label: 'Depo Hücresi'
  },
  warehouse_stack: {
    color: '#D9F99D',
    stroke: '#3F6212',
    Icon: Warehouse,
    label: 'Depo Hücresi'
  },
  warehouse_door: {
    color: '#DBEAFE',
    stroke: '#1D4ED8',
    Icon: LogIn,
    label: 'Depo Kapısı'
  },
  cashier: {
    color: '#DCFCE7',
    stroke: '#15803D',
    Icon: ShoppingCart,
    label: 'Kasa'
  },
  entrance: {
    color: '#D1FAE5',
    stroke: '#047857',
    Icon: LogIn,
    label: 'Giriş'
  },
  exit: {
    color: '#FFE4E6',
    stroke: '#BE123C',
    Icon: LogOut,
    label: 'Çıkış'
  },
  aisle: {
    color: 'rgba(203, 213, 225, 0.18)',
    stroke: '#94A3B8',
    Icon: MoveHorizontal,
    label: 'Koridor',
    strokeDasharray: '4,4'
  },
  zone: {
    color: '#EDE9FE',
    stroke: '#7C3AED',
    Icon: MapPin,
    label: 'Bölge'
  },
  cold_cabinet: {
    color: '#E0F2FE',
    stroke: '#0284C7',
    Icon: Snowflake,
    label: 'Soğuk Dolap'
  },
  campaign_stand: {
    color: '#FCE7F3',
    stroke: '#BE185D',
    Icon: Star,
    label: 'Kampanya Standı'
  },
  service_area: {
    color: '#FAE8FF',
    stroke: '#A21CAF',
    Icon: Wrench,
    label: 'Servis Alanı'
  },
  empty_area: {
    color: '#E5E7EB',
    stroke: '#94A3B8',
    Icon: Square,
    label: 'Boş Alan'
  },
  custom: {
    color: '#F5F3FF',
    stroke: '#7C3AED',
    Icon: Settings,
    label: 'Özel Alan'
  }
};

const PRIMARY_LABEL_TYPES = new Set([
  'section',
  'section_common_area',
  'warehouse_common_area',
  'warehouse_door',
  'cashier',
  'entrance',
  'exit',
  'aisle',
  'zone',
  'cold_cabinet',
  'campaign_stand',
  'service_area',
]);

const OUTLINE_ONLY_TYPES = new Set([
  'aisle',
  'empty_area',
  'zone',
  'boundary',
  'store_boundary',
  'warehouse_boundary',
  'store_zone',
  'warehouse_zone',
  'layout_boundary',
  'layout_zone',
]);

export const SELECTABLE_PLAN_OBJECT_TYPES = new Set([
  'section',
  'shelf',
  'shelf_stack',
  'warehouse_location',
  'warehouse_stack',
  'section_common_area',
  'warehouse_common_area',
  'cashier',
  'entrance',
  'exit',
  'warehouse_door',
  'service_area',
  'custom',
  'cold_cabinet',
  'campaign_stand',
]);

const normalizePlanObjectType = (objectType) => {
  if (objectType === 'shelf_stack') return 'shelf';
  if (objectType === 'warehouse_stack') return 'warehouse_location';
  return objectType;
};

export const isSelectablePlanObject = (itemOrType) => {
  const objectType = typeof itemOrType === 'string'
    ? itemOrType
    : itemOrType?.objectType;
  const normalizedType = normalizePlanObjectType(objectType);
  return SELECTABLE_PLAN_OBJECT_TYPES.has(objectType) || SELECTABLE_PLAN_OBJECT_TYPES.has(normalizedType);
};

const stripEmojis = (str) => {
  if (!str) return '';
  return str
    .replace(/[\u{1F300}-\u{1F9FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{1F191}-\u{1F251}\u{1F900}-\u{1F9FF}\u{1F300}-\u{1F5FF}\u{1F500}-\u{1F5FF}\u{2702}-\u{27B0}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{2B00}-\u{2BFF}\u{2900}-\u{297F}]/gu, '')
    .trim();
};

const getShortLabel = (objectType, label) => {
  if (!label) return '';
  if (objectType === 'shelf') {
    const parts = label.split('-');
    if (parts.length >= 4) {
      return `${parts[2]}-${parts[3]}`;
    }
    if (parts.length === 3) {
      return `${parts[1]}-${parts[2]}`;
    }
    return label;
  }
  if (objectType === 'warehouse_location') {
    const parts = label.split('-');
    if (parts.length >= 4) {
      return `${parts[2]}-${parts[3]}`;
    }
    if (parts.length === 3) {
      return `${parts[1]}-${parts[2]}`;
    }
    return label;
  }
  return label;
};

const truncateLabel = (label, width, objectType) => {
  if (!label) return '';
  
  if (
    objectType === 'section' || 
    objectType === 'section_common_area' || 
    objectType === 'warehouse_common_area' || 
    objectType === 'cashier' || 
    objectType === 'service_area'
  ) {
    const maxChars = Math.max(3, Math.floor(width / 6));
    if (label.length > maxChars) {
      return label.substring(0, maxChars - 1) + '…';
    }
    return label;
  }
  
  const maxChars = Math.max(2, Math.floor(width / 5.5));
  if (label.length > maxChars) {
    return label.substring(0, maxChars - 1) + '…';
  }
  return label;
};

const genericSectionCommonLabels = new Set([
  'ortak reyon',
  'ortak reyon alanı',
  'section_common_area',
]);

const resolveCommonAreaLabel = (item, cleanLabel) => {
  if (item.objectType === 'warehouse_common_area') {
    return {
      title: cleanLabel || 'Ortak Depo',
      subtitle: 'Ortak Alan',
    };
  }

  const normalizedLabel = String(cleanLabel || '').trim().toLocaleLowerCase('tr-TR');
  const sectionName = item.metadata?.sectionName || '';
  const rawTitle = sectionName || (!genericSectionCommonLabels.has(normalizedLabel) ? cleanLabel : '');
  const title = String(rawTitle || 'Ortak Alan').replace(/\s+Ortak\s+Alanı$/i, '').trim() || 'Ortak Alan';

  return {
    title,
    subtitle: 'Ortak Alan',
  };
};

const getResponsiveCommonAreaLabel = (item, cleanLabel, detailLevel) => {
  const commonAreaLabel = resolveCommonAreaLabel(item, cleanLabel);
  const sectionName = String(item.metadata?.sectionName || commonAreaLabel.title || '').trim();

  if (detailLevel === 'overview') {
    return { primary: 'Ortak', secondary: null, showCount: false };
  }

  if (detailLevel === 'standard') {
    if (item.objectType === 'warehouse_common_area') {
      return { primary: 'Ortak Depo', secondary: null, showCount: false };
    }
    return { primary: sectionName || 'Ortak', secondary: 'Ortak', showCount: false };
  }

  if (item.objectType === 'warehouse_common_area') {
    return { primary: 'Ortak Depo Alanı', secondary: null, showCount: true };
  }

  return {
    primary: sectionName ? `${sectionName} Ortak Alanı` : 'Ortak Reyon Alanı',
    secondary: null,
    showCount: true,
  };
};

const LocationPlanObject = memo(({
  item,
  isSelected,
  isHighlighted = false,
  onClick,
  detailLevel = 'detail',
  isOverlayOnly = false,
  stopMouseDownPropagation = true,
}) => {
  const { objectType, x, y, width, height, rotation, label, color } = item;
  const isSelectable = isSelectablePlanObject(item);

  const transform = `translate(${x}, ${y}) rotate(${rotation || 0}, ${width / 2}, ${height / 2})`;

  const style = TYPE_STYLES[objectType] || TYPE_STYLES.custom;

  let rectColor = color || style.color;
  const isOutlineOnlyType = !isSelectable || OUTLINE_ONLY_TYPES.has(objectType);
  if (isOutlineOnlyType) rectColor = 'none';

  let strokeColor = isSelected ? '#38bdf8' : (isHighlighted ? '#ef4444' : style.stroke);
  let strokeWidth = isSelected ? 3.5 : (isHighlighted ? 4.5 : 1.2);
  let strokeDasharray = isSelected ? 'none' : (isHighlighted ? 'none' : (style.strokeDasharray || ''));
  if (!isSelectable) {
    strokeWidth = 1;
    strokeDasharray = '';
  }

  if (isOverlayOnly) {
    return (
      <g transform={transform} style={{ pointerEvents: 'none' }}>
        <rect
          x={0}
          y={0}
          width={width}
          height={height}
          fill="none"
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeDasharray={strokeDasharray}
          rx={objectType === 'section' ? 6 : objectType === 'shelf' ? 2 : 4}
          ry={objectType === 'section' ? 6 : objectType === 'shelf' ? 2 : 4}
        />
      </g>
    );
  }

  const cleanLabel = label ? stripEmojis(label) : '';
  const cleanTypeLabel = style.label ? stripEmojis(style.label) : '';
  const isStack = (
    objectType === 'shelf'
    || objectType === 'warehouse_location'
    || objectType === 'shelf_stack'
    || objectType === 'warehouse_stack'
  ) && Array.isArray(item.metadata?.levels);
  const showLabel = isSelectable && (
    detailLevel === 'detail'
    || PRIMARY_LABEL_TYPES.has(objectType)
    || (detailLevel === 'standard' && isStack)
  );
  const showIcon = detailLevel === 'detail' && height > 28;

  const isCommonArea = objectType === 'section_common_area' || objectType === 'warehouse_common_area';
  const isVerticalCommonArea = isCommonArea && height > width * 1.25;
  const productCount = item.metadata?.commonProductCount || 0;
  const commonAreaLabel = isCommonArea ? getResponsiveCommonAreaLabel(item, cleanLabel, detailLevel) : null;
  const levelCount = item.metadata?.levelCount || item.metadata?.levels?.length || 0;
  const occupiedLevelCount = item.metadata?.occupiedLevelCount
    ?? item.metadata?.levels?.filter((level) => (
      (level.products || []).length > 0 || Number(level.occupancy || 0) > 0
    )).length
    ?? 0;
  const isEmptyStack = isStack && occupiedLevelCount === 0;

  let displayLabel = cleanLabel;
  if (
    objectType === 'shelf'
    || objectType === 'warehouse_location'
    || objectType === 'shelf_stack'
    || objectType === 'warehouse_stack'
  ) {
    displayLabel = getShortLabel(normalizePlanObjectType(objectType), cleanLabel);
  }
  const truncatedLabelText = truncateLabel(displayLabel, width, objectType);

  return (
    <g
      data-object-id={isSelectable ? String(item.id) : undefined}
      className={`lm-plan-object lm-plan-object-${objectType} ${isStack ? 'lm-plan-shelf-stack' : ''} ${isEmptyStack ? 'is-empty-stack' : ''} ${isCommonArea ? 'lm-plan-common-area' : ''} ${objectType === 'section_common_area' ? 'lm-plan-common-area--section' : ''} ${objectType === 'warehouse_common_area' ? 'lm-plan-common-area--warehouse' : ''} ${isSelectable ? '' : 'is-decorative'} ${isSelected ? 'is-selected' : ''} ${isHighlighted ? 'is-highlighted' : ''}`}
      transform={transform}
      style={isSelectable ? undefined : { pointerEvents: 'none' }}
      onMouseDown={isSelectable && stopMouseDownPropagation ? (e) => e.stopPropagation() : undefined}
      onClick={isSelectable ? (e) => {
        e.stopPropagation();
        onClick(item);
      } : undefined}
    >
      <title>{`${cleanLabel || cleanTypeLabel} [${objectType.toUpperCase()}]`}</title>
      <rect
        x={0}
        y={0}
        width={width}
        height={height}
        fill={rectColor}
        fillOpacity={isOutlineOnlyType ? 0 : isEmptyStack ? 0.5 : 0.9}
        stroke={strokeColor}
        strokeWidth={strokeWidth}
        strokeDasharray={strokeDasharray}
        rx={objectType === 'section' ? 6 : objectType === 'shelf' ? 2 : 4}
        ry={objectType === 'section' ? 6 : objectType === 'shelf' ? 2 : 4}
        className="lm-plan-object-surface"
        pointerEvents="none"
      />
      {isSelectable && (
        <rect
          x={0}
          y={0}
          width={width}
          height={height}
          fill="transparent"
          pointerEvents="all"
          rx={objectType === 'section' ? 6 : objectType === 'shelf' ? 2 : 4}
          ry={objectType === 'section' ? 6 : objectType === 'shelf' ? 2 : 4}
          className="lm-plan-hit-area"
        />
      )}
      {showLabel && width > 24 && height > 12 && (
        <g pointerEvents="none">
          {/* Symbol */}
          {showIcon && style.Icon && !isCommonArea && objectType !== 'section' && (
            <foreignObject
              x={width / 2 - 7}
              y={height / 2 - 14}
              width={14}
              height={14}
              style={{ pointerEvents: 'none' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', color: strokeColor }}>
                <style.Icon size={12} strokeWidth={2} />
              </div>
            </foreignObject>
          )}
          {/* Label / Text */}
          {objectType === 'section' ? (
            <text
              x={width / 2}
              y={height / 2}
              textAnchor="middle"
              dominantBaseline="middle"
              transform={`rotate(-90, ${width / 2}, ${height / 2})`}
              className="lm-plan-section-label"
            >
              {truncateLabel(cleanLabel, Math.max(70, height), objectType)}
            </text>
          ) : isCommonArea ? (
            <g
              className="lm-plan-common-content"
              transform={isVerticalCommonArea
                ? `rotate(-90, ${width / 2}, ${height / 2})`
                : undefined}
            >
              <text
                x={width / 2}
                y={height / 2 - 8}
                textAnchor="middle"
                className="lm-plan-common-title"
              >
                {truncateLabel(commonAreaLabel.primary, Math.max(40, isVerticalCommonArea ? height : width), objectType)}
              </text>
              {commonAreaLabel.secondary ? (
                <text
                  x={width / 2}
                  y={height / 2 + 2}
                  textAnchor="middle"
                  className="lm-plan-common-subtitle"
                >
                  {commonAreaLabel.secondary}
                </text>
              ) : null}
              {commonAreaLabel.showCount ? (
                <text
                  x={width / 2}
                  y={height / 2 + (commonAreaLabel.secondary ? 16 : 14)}
                  textAnchor="middle"
                  className="lm-plan-common-count"
                >
                  {productCount} ürün
                </text>
              ) : null}
            </g>
          ) : isStack ? (
            <g className="lm-plan-shelf-stack-label">
              <text
                x={8}
                y={height / 2 + 3}
                textAnchor="start"
                className="lm-plan-shelf-stack-code"
              >
                {truncateLabel(displayLabel, Math.max(34, width - 34), objectType)}
              </text>
              <g transform={`translate(${Math.max(4, width - 29)}, ${Math.max(3, height / 2 - 7)})`}>
                <rect width="25" height="14" rx="7" className="lm-plan-shelf-stack-badge" />
                <text x="12.5" y="9.7" textAnchor="middle" className="lm-plan-shelf-stack-count">
                  {occupiedLevelCount}/{levelCount}
                </text>
              </g>
            </g>
          ) : (
            <text
              x={width / 2}
              y={showIcon ? height / 2 + 9 : height / 2 + 3}
              textAnchor="middle"
              fill={objectType === 'aisle' ? '#94a3b8' : '#0f172a'}
              fontSize={objectType === 'section' ? '9px' : '7px'}
              fontWeight={objectType === 'section' ? 'bold' : 'normal'}
              style={{
                userSelect: 'none',
                pointerEvents: 'none',
                fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
              }}
            >
              {truncatedLabelText}
            </text>
          )}
        </g>
      )}
    </g>
  );
}, (previous, next) => (
  previous.item === next.item
  && previous.isSelected === next.isSelected
  && previous.isHighlighted === next.isHighlighted
  && previous.onClick === next.onClick
  && previous.detailLevel === next.detailLevel
  && previous.isOverlayOnly === next.isOverlayOnly
  && previous.stopMouseDownPropagation === next.stopMouseDownPropagation
));

LocationPlanObject.displayName = 'LocationPlanObject';
export default LocationPlanObject;
