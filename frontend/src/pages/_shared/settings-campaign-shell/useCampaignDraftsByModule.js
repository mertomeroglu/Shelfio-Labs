import { useState } from 'react';

export const CAMPAIGN_DRAFT_MODULE_KEYS = ['general', 'product', 'category', 'brand', 'expiry', 'sales', 'dynamic'];

export const normalizeCampaignDraftModuleKey = (value, fallback = 'general') => {
  const normalized = String(value || '').trim();
  if (normalized === 'all' || normalized === 'giftCards') return fallback;
  return CAMPAIGN_DRAFT_MODULE_KEYS.includes(normalized) ? normalized : fallback;
};

export const getDefaultCampaignTypeForModule = (moduleKey = 'general') => {
  const normalized = normalizeCampaignDraftModuleKey(moduleKey);
  if (normalized === 'expiry' || normalized === 'sales') return 'dynamic';
  return normalized;
};

export const createDefaultCampaignDraft = (moduleKey = 'general') => {
  const normalizedModule = normalizeCampaignDraftModuleKey(moduleKey);
  const defaultType = getDefaultCampaignTypeForModule(normalizedModule);
  return {
    name: '',
    internalName: '',
    recommendationTitle: '',
    publicName: '',
    type: defaultType,
    sourceModule: normalizedModule === 'general' ? '' : normalizedModule,
    discountRate: '',
    startsAt: '',
    endsAt: '',
    isIndefinite: false,
    priority: 0,
    targetCategoryIds: [],
    targetCategoryLabelIds: [],
    targetProductIds: [],
    targetBrands: [],
    triggerSalesSpeed: 'any',
    triggerTrendDirection: 'any',
    minOverStockRatio: '1.2',
    isActive: true,
    targetBrand: '',
    targetProductIdsText: '',
    giftCardRewardEnabled: false,
    giftCardRewardCode: '',
    dynamicRule: {
      salesBelow: '1',
      stockAbove: '40',
      expiryBelow: '10',
      discountRate: '15',
    },
  };
};

export const createDefaultCampaignDraftsByModule = () => Object.fromEntries(
  CAMPAIGN_DRAFT_MODULE_KEYS.map((moduleKey) => [moduleKey, createDefaultCampaignDraft(moduleKey)])
);

export const useCampaignDraftsByModule = (activeModule = 'general') => {
  const [campaignDraftsByModule, setCampaignDraftsByModule] = useState(createDefaultCampaignDraftsByModule());
  const activeCampaignDraftModule = normalizeCampaignDraftModuleKey(activeModule, 'general');

  const getActiveCampaignDraft = (moduleKey = activeCampaignDraftModule) => {
    const safeModuleKey = normalizeCampaignDraftModuleKey(moduleKey, activeCampaignDraftModule);
    return campaignDraftsByModule[safeModuleKey] || createDefaultCampaignDraft(safeModuleKey);
  };

  const updateCampaignDraft = (moduleKey, patch) => {
    const safeModuleKey = normalizeCampaignDraftModuleKey(moduleKey, activeCampaignDraftModule);
    setCampaignDraftsByModule((current) => {
      const previousDraft = current[safeModuleKey] || createDefaultCampaignDraft(safeModuleKey);
      const nextPatch = typeof patch === 'function' ? patch(previousDraft) : patch;
      return {
        ...current,
        [safeModuleKey]: {
          ...previousDraft,
          ...(nextPatch && typeof nextPatch === 'object' ? nextPatch : {}),
        },
      };
    });
  };

  const hydrateCampaignDraft = (moduleKey, payload) => {
    const safeModuleKey = normalizeCampaignDraftModuleKey(moduleKey, activeCampaignDraftModule);
    setCampaignDraftsByModule((current) => ({
      ...current,
      [safeModuleKey]: {
        ...createDefaultCampaignDraft(safeModuleKey),
        ...(payload && typeof payload === 'object' ? payload : {}),
      },
    }));
  };

  const resetCampaignDraft = (moduleKey = activeCampaignDraftModule) => {
    const safeModuleKey = normalizeCampaignDraftModuleKey(moduleKey, activeCampaignDraftModule);
    setCampaignDraftsByModule((current) => ({
      ...current,
      [safeModuleKey]: createDefaultCampaignDraft(safeModuleKey),
    }));
  };

  const resetAllCampaignDrafts = () => {
    setCampaignDraftsByModule(createDefaultCampaignDraftsByModule());
  };

  return {
    activeCampaignDraftModule,
    campaignDraftsByModule,
    campaignDraft: getActiveCampaignDraft(activeCampaignDraftModule),
    getActiveCampaignDraft,
    updateCampaignDraft,
    hydrateCampaignDraft,
    resetCampaignDraft,
    resetAllCampaignDrafts,
  };
};

export const useCampaignDrafts = useCampaignDraftsByModule;
