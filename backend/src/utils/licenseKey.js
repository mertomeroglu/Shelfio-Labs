import crypto from 'node:crypto';

export const normalizeLicenseKey = (value) => String(value || '')
  .trim()
  .toUpperCase()
  .replace(/\s+/g, '');

export const hashLicenseKey = (value) =>
  crypto.createHash('sha256').update(normalizeLicenseKey(value)).digest('hex');

export const maskLicenseKey = (value) => {
  const normalized = normalizeLicenseKey(value);
  if (!normalized) return '';

  const parts = normalized.split('-').filter(Boolean);
  if (parts.length >= 3) {
    return [parts[0], ...parts.slice(1, -1).map(() => '****'), parts[parts.length - 1]].join('-');
  }

  if (normalized.length <= 8) return '****';
  return `${normalized.slice(0, 4)}-****-${normalized.slice(-4)}`;
};
