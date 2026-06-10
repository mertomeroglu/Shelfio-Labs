import { useMemo, useState } from 'react';

const countActivePricingFilters = ({ filters, selectedPreset, criticalFilterActive }) => (
  [
    filters.risk,
    filters.sktStatus,
    filters.salesSpeed,
    filters.primaryAction,
    filters.categoryId,
    filters.campaignEligibility,
    filters.conflict,
    filters.blockingReason,
    filters.activeCampaignConflict,
    filters.guardrail,
    filters.hasSuggestion !== '' ? 'suggestion' : '',
    selectedPreset,
    criticalFilterActive ? 'critical' : '',
  ].filter(Boolean).length
);

export function usePricingFilters({
  defaults,
  actionTypes,
  applyPreset,
  onPresetChange,
  onCardFilterChange,
  onReset,
} = {}) {
  const [filters, setFilters] = useState(defaults);
  const [selectedPreset, setSelectedPreset] = useState('');
  const [criticalFilterActive, setCriticalFilterActive] = useState(false);

  const activeFilterCount = useMemo(
    () => countActivePricingFilters({ filters, selectedPreset, criticalFilterActive }),
    [criticalFilterActive, filters, selectedPreset],
  );

  const handlePresetClick = (presetId) => {
    const nextPreset = selectedPreset === presetId ? '' : presetId;
    setSelectedPreset(nextPreset);
    setFilters((prev) => applyPreset(prev, nextPreset));
    onPresetChange?.();
  };

  const handleCardFilter = (mode) => {
    if (Object.values(actionTypes || {}).includes(mode)) {
      setFilters((prev) => ({ ...prev, primaryAction: mode, hasSuggestion: '' }));
      setSelectedPreset('');
      setCriticalFilterActive(false);
      onCardFilterChange?.();
      return;
    }
    setFilters(defaults);
    setSelectedPreset('');
    setCriticalFilterActive(false);
    onCardFilterChange?.();
  };

  const resetFilters = () => {
    setFilters(defaults);
    setSelectedPreset('');
    setCriticalFilterActive(false);
    onReset?.();
  };

  return {
    filters,
    setFilters,
    selectedPreset,
    setSelectedPreset,
    criticalFilterActive,
    setCriticalFilterActive,
    activeFilterCount,
    handlePresetClick,
    handleCardFilter,
    resetFilters,
  };
}
