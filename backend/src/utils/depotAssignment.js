import { normalizeStorageTypeCode } from './displayLabels.js';

export const DEPOT_ASSIGNMENT_TYPES = {
  FIXED_PALLET: 'fixed_pallet',
  SHARED_OVERFLOW: 'shared_overflow',
  DIRECT_SUPPLY: 'direct_supply',
  NO_BACKROOM_STOCK: 'no_backroom_stock',
};

export const CAPACITY_MODES = {
  BOUNDED: 'bounded',
  UNBOUNDED_VIRTUAL: 'unbounded_virtual',
  NOT_APPLICABLE: 'not_applicable',
  NO_CAPACITY: 'no_capacity',
  NEEDS_REVIEW: 'needs_review',
};

export const VIRTUAL_DEPOT_LOCATIONS = [
  {
    depotLocationCode: 'OVR-AMBIENT',
    depotZoneCode: 'VIRTUAL-OVERFLOW-AMBIENT',
    storageType: 'Ortam',
    displayLabel: 'Ortam Ortak Alan',
    depotAssignmentType: DEPOT_ASSIGNMENT_TYPES.SHARED_OVERFLOW,
    stockingStrategy: 'shared_overflow',
    assignmentPriority: 50,
  },
  {
    depotLocationCode: 'OVR-COLD',
    depotZoneCode: 'VIRTUAL-OVERFLOW-COLD',
    storageType: 'cold_chain',
    displayLabel: 'Soğuk Ortak Alan',
    depotAssignmentType: DEPOT_ASSIGNMENT_TYPES.SHARED_OVERFLOW,
    stockingStrategy: 'shared_overflow',
    assignmentPriority: 50,
  },
  {
    depotLocationCode: 'OVR-FROZEN',
    depotZoneCode: 'VIRTUAL-OVERFLOW-FROZEN',
    storageType: 'freezer',
    displayLabel: 'Donuk Ortak Alan',
    depotAssignmentType: DEPOT_ASSIGNMENT_TYPES.SHARED_OVERFLOW,
    stockingStrategy: 'shared_overflow',
    assignmentPriority: 50,
  },
  {
    depotLocationCode: 'DIRECT-SUPPLY',
    depotZoneCode: 'VIRTUAL-DIRECT-SUPPLY',
    storageType: 'mixed',
    displayLabel: 'Doğrudan Tedarik',
    depotAssignmentType: DEPOT_ASSIGNMENT_TYPES.DIRECT_SUPPLY,
    stockingStrategy: 'direct_supply',
    assignmentPriority: 80,
  },
  {
    depotLocationCode: 'NO-BACKROOM',
    depotZoneCode: 'VIRTUAL-NO-BACKROOM',
    storageType: 'mixed',
    displayLabel: 'Arka Depo Yok',
    depotAssignmentType: DEPOT_ASSIGNMENT_TYPES.NO_BACKROOM_STOCK,
    stockingStrategy: 'no_backroom_stock',
    assignmentPriority: 90,
  },
];

const normalizeText = (value) => String(value || '').trim().toLocaleLowerCase('tr-TR');

export const normalizeDepotStorageType = (value) => {
  const normalized = normalizeStorageTypeCode(value);
  if (normalized === 'freezer' || normalized === 'cold_chain') return normalized;
  const text = normalizeText(value);
  if (text.includes('dondur') || text === 'freezer') return 'freezer';
  if (text.includes('soğuk') || text.includes('soguk') || text === 'cold_chain') return 'cold_chain';
  return 'Ortam';
};

export const isPhysicalDepotLocationCode = (value) => /^D\d+-[LR]-\d{2}-\d{2}$/i.test(String(value || '').trim());

export const getVirtualDepotLocation = (code) =>
  VIRTUAL_DEPOT_LOCATIONS.find((item) => item.depotLocationCode === String(code || '').trim()) || null;

export const getVirtualDepotForStorageType = (storageType) => {
  const normalized = normalizeDepotStorageType(storageType);
  if (normalized === 'freezer') return getVirtualDepotLocation('OVR-FROZEN');
  if (normalized === 'cold_chain') return getVirtualDepotLocation('OVR-COLD');
  return getVirtualDepotLocation('OVR-AMBIENT');
};

export const resolveDepotAssignment = ({
  physicalLocationCode = '',
  storageType = 'Ortam',
  isListed = true,
  warehouseQuantity = 0,
  shelfQuantity = 0,
  noBackroomStock = false,
} = {}) => {
  const normalizedStorageType = normalizeDepotStorageType(storageType);
  const normalizedPhysicalCode = String(physicalLocationCode || '').trim();

  if (normalizedPhysicalCode && isPhysicalDepotLocationCode(normalizedPhysicalCode)) {
    return {
      depotAssignmentType: DEPOT_ASSIGNMENT_TYPES.FIXED_PALLET,
      depotLocationCode: normalizedPhysicalCode,
      depotZoneCode: normalizedPhysicalCode.replace(/-\d{2}$/, ''),
      isVirtualLocation: false,
      capacityMode: CAPACITY_MODES.BOUNDED,
      storageType: normalizedStorageType,
      assignmentPriority: 10,
      stockingStrategy: 'fixed_pallet',
      depotLocationLabel: normalizedPhysicalCode,
    };
  }

  if (noBackroomStock || (!Number(warehouseQuantity || 0) && Number(shelfQuantity || 0) > 0)) {
    const fallback = getVirtualDepotLocation('NO-BACKROOM');
    return {
      ...fallback,
      isVirtualLocation: true,
      capacityMode: CAPACITY_MODES.NO_CAPACITY,
      storageType: normalizedStorageType,
      depotLocationLabel: fallback.displayLabel,
    };
  }

  if (isListed === false && !Number(warehouseQuantity || 0)) {
    const fallback = getVirtualDepotLocation('DIRECT-SUPPLY');
    return {
      ...fallback,
      isVirtualLocation: true,
      capacityMode: CAPACITY_MODES.NOT_APPLICABLE,
      storageType: normalizedStorageType,
      depotLocationLabel: fallback.displayLabel,
    };
  }

  const fallback = getVirtualDepotForStorageType(normalizedStorageType);
  return {
    ...fallback,
    isVirtualLocation: true,
    capacityMode: CAPACITY_MODES.UNBOUNDED_VIRTUAL,
    storageType: normalizedStorageType,
    depotLocationLabel: fallback.displayLabel,
  };
};

export const buildVirtualDepotZones = (now = new Date().toISOString()) =>
  VIRTUAL_DEPOT_LOCATIONS.map((item) => ({
    id: `zone-${item.depotLocationCode.toLowerCase()}`,
    depotZoneCode: item.depotZoneCode,
    depotLocationCode: item.depotLocationCode,
    locationCode: item.depotLocationCode,
    zoneType: 'virtual_overflow',
    isVirtualLocation: true,
    capacityMode: item.depotAssignmentType === DEPOT_ASSIGNMENT_TYPES.DIRECT_SUPPLY
      ? CAPACITY_MODES.NOT_APPLICABLE
      : item.depotAssignmentType === DEPOT_ASSIGNMENT_TYPES.NO_BACKROOM_STOCK
        ? CAPACITY_MODES.NO_CAPACITY
        : CAPACITY_MODES.UNBOUNDED_VIRTUAL,
    storageType: item.storageType,
    storageTypeLabel: item.displayLabel,
    displayLabel: item.displayLabel,
    depotAssignmentType: item.depotAssignmentType,
    stockingStrategy: item.stockingStrategy,
    assignmentPriority: item.assignmentPriority,
    palletCapacity: null,
    capacity: null,
    totalLocations: null,
    occupiedLocations: null,
    emptyLocations: null,
    createdAt: now,
    updatedAt: now,
  }));
