const READABLE_CODE_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const normalizeRandomCodeValue = (value) => String(value || '').trim().toUpperCase();

export const generateRandomCode = ({
  length = 5,
  charset = READABLE_CODE_CHARSET,
  excludedCodes = new Set(),
  maxAttempts = 300,
} = {}) => {
  const normalizedCharset = String(charset || READABLE_CODE_CHARSET);
  const normalizedExcluded = new Set(Array.from(excludedCodes || []).map((code) => normalizeRandomCodeValue(code)));
  const safeLength = Number.isInteger(length) && length > 0 ? length : 5;
  const safeAttempts = Number.isInteger(maxAttempts) && maxAttempts > 0 ? maxAttempts : 300;

  if (!normalizedCharset.length) return '';

  for (let attempt = 0; attempt < safeAttempts; attempt += 1) {
    let candidate = '';
    for (let index = 0; index < safeLength; index += 1) {
      const randomIndex = Math.floor(Math.random() * normalizedCharset.length);
      candidate += normalizedCharset[randomIndex];
    }

    if (!normalizedExcluded.has(candidate)) {
      return candidate;
    }
  }

  return '';
};
