import { AppError } from './appError.js';

export const CURSOR_VERSION = 1;

export const parseLimit = (value, { defaultLimit, maxLimit }) => {
  const parsed = value === undefined || value === '' ? defaultLimit : Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new AppError(400, 'limit must be a positive number');
  }
  return Math.min(maxLimit, Math.floor(parsed));
};

export const parsePagePagination = ({ page, limit }, { defaultLimit, maxLimit }) => {
  const parsedPage = page === undefined || page === '' ? 1 : Number(page);
  if (!Number.isFinite(parsedPage) || parsedPage < 1) {
    throw new AppError(400, 'page must be a positive number');
  }
  const safePage = Math.floor(parsedPage);
  const safeLimit = parseLimit(limit, { defaultLimit, maxLimit });
  return {
    mode: 'offset',
    page: safePage,
    limit: safeLimit,
    skip: (safePage - 1) * safeLimit,
  };
};

export const encodeCursor = (payload, { sort } = {}) => Buffer
  .from(JSON.stringify({ v: CURSOR_VERSION, sort, ...payload }), 'utf8')
  .toString('base64url');

export const decodeCursor = (cursor, { expectedSort } = {}) => {
  if (!cursor) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'));
  } catch {
    throw new AppError(400, 'cursor is invalid');
  }

  if (payload?.v !== CURSOR_VERSION) {
    throw new AppError(400, 'cursor version is not supported');
  }

  if (expectedSort && payload.sort !== expectedSort) {
    throw new AppError(400, 'cursor does not match the requested sort');
  }

  return payload;
};

export const resolvePaginationMode = (value) => (
  ['cursor', 'keyset'].includes(String(value || '').toLowerCase()) ? 'cursor' : 'offset'
);

export const parseBooleanQuery = (value, defaultValue = true) => {
  if (value === undefined || value === '') return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes'].includes(normalized)) return true;
  if (['0', 'false', 'no'].includes(normalized)) return false;
  throw new AppError(400, 'boolean query parameter is invalid');
};

const camelToSnake = (value) => String(value || '')
  .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
  .replace(/[-\s.]+/g, '_')
  .toLowerCase();

const snakeToCamel = (value) => String(value || '')
  .replace(/_([a-z0-9])/g, (_, char) => char.toUpperCase());

const unique = (values) => Array.from(new Set(values.filter(Boolean)));

const parseSortValue = (value) => {
  const requested = String(value || '').trim();
  if (!requested) return null;

  if (requested.startsWith('-')) {
    return { field: requested.slice(1), direction: 'desc' };
  }

  const separated = requested.match(/^(.+?)(?::|\.)(asc|desc)$/i);
  if (separated) {
    return { field: separated[1], direction: separated[2].toLowerCase() };
  }

  const underscored = requested.match(/^(.+)_(asc|desc)$/i);
  if (underscored) {
    return { field: underscored[1], direction: underscored[2].toLowerCase() };
  }

  return { field: requested, direction: null };
};

const resolveSortCandidate = (value, allowed = []) => {
  const requested = String(value || '').trim();
  if (!requested) return null;
  if (allowed.includes(requested)) return requested;

  const parsed = parseSortValue(requested);
  if (!parsed?.field) return null;

  const fields = unique([
    parsed.field,
    camelToSnake(parsed.field),
    snakeToCamel(camelToSnake(parsed.field)),
  ]);
  const directions = parsed.direction ? [parsed.direction] : ['asc', 'desc'];

  for (const field of fields) {
    for (const direction of directions) {
      const candidate = `${field}_${direction}`;
      if (allowed.includes(candidate)) return candidate;
    }
  }

  return null;
};

// Accept the common UI/API spellings for the same sort contract:
// field_asc, field:asc, field.asc, -field, and camel/snake field aliases.
export const resolveWhitelistedSort = (value, allowed, fallback, options = {}) => {
  const allowedValues = Array.isArray(allowed) ? allowed : [];
  const safeFallback = allowedValues.includes(fallback) ? fallback : allowedValues[0];
  const requested = String(value || '').trim();
  const resolved = resolveSortCandidate(requested || safeFallback, allowedValues);

  if (resolved) return resolved;

  if (options.strict === true) {
    throw new AppError(400, 'sort is not supported');
  }

  if (requested && safeFallback) {
    const context = options.context ? ` ${options.context}` : '';
    console.warn(`[sort:fallback]${context}`, {
      requested,
      fallback: safeFallback,
      allowed: allowedValues,
    });
  }

  return safeFallback;
};
