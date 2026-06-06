import { config } from '../config/config.js';

const LICENSE_MODES = new Set(['off', 'shadow', 'enforce']);

export const getLicenseEnforcementMode = () => {
  try {
    const mode = String(config.licenseEnforcementMode || 'off').trim().toLowerCase();
    return LICENSE_MODES.has(mode) ? mode : 'off';
  } catch {
    return 'off';
  }
};

export const isLicenseControlEnabled = () => {
  try {
    return config.licenseControlEnabled === true && getLicenseEnforcementMode() !== 'off';
  } catch {
    return false;
  }
};

export const isShadowMode = () => {
  try {
    return isLicenseControlEnabled() && getLicenseEnforcementMode() === 'shadow';
  } catch {
    return false;
  }
};

export const isEnforceMode = () => {
  try {
    return isLicenseControlEnabled() && getLicenseEnforcementMode() === 'enforce';
  } catch {
    return false;
  }
};

export const isLicenseControlConfigured = () => {
  try {
    return Boolean(
      String(config.getshelfioControlApiUrl || '').trim()
      && String(config.getshelfioControlSecret || '').trim()
    );
  } catch {
    return false;
  }
};

export const getLicenseControlPublicState = () => {
  try {
    return {
      enabled: isLicenseControlEnabled(),
      mode: getLicenseEnforcementMode(),
      configured: isLicenseControlConfigured(),
      failOpen: Boolean(config.licenseControlFailOpen),
    };
  } catch {
    return {
      enabled: false,
      mode: 'off',
      configured: false,
      failOpen: true,
    };
  }
};
