import { config } from '../config/config.js';

export const getLicenseEnforcementMode = () => config.licenseEnforcementMode || 'off';

export const isLicenseControlEnabled = () =>
  Boolean(config.licenseControlEnabled) && getLicenseEnforcementMode() !== 'off';

export const isShadowMode = () => isLicenseControlEnabled() && getLicenseEnforcementMode() === 'shadow';

export const isEnforceMode = () => isLicenseControlEnabled() && getLicenseEnforcementMode() === 'enforce';

export const isLicenseControlConfigured = () =>
  Boolean(config.getshelfioControlApiUrl && config.getshelfioControlSecret);

export const getLicenseControlPublicState = () => ({
  enabled: isLicenseControlEnabled(),
  mode: getLicenseEnforcementMode(),
  configured: isLicenseControlConfigured(),
  failOpen: Boolean(config.licenseControlFailOpen),
});
