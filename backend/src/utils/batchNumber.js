import { createHash } from 'crypto';

const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const OLD_GENERATED_BATCH_PATTERN = /^OPN-(?:\d{6}-F\d+|SHF-\d{2}-\d+)-(\d{2})$/i;

const TURKISH_CHAR_MAP = {
  Ç: 'C',
  Ğ: 'G',
  İ: 'I',
  Ö: 'O',
  Ş: 'S',
  Ü: 'U',
  ç: 'C',
  ğ: 'G',
  ı: 'I',
  i: 'I',
  ö: 'O',
  ş: 'S',
  ü: 'U',
};

export const isLegacyGeneratedBatchNo = (value) => OLD_GENERATED_BATCH_PATTERN.test(String(value || '').trim());

export const resolveLegacyBatchSequence = (value, fallback = '01') => {
  const match = String(value || '').trim().match(OLD_GENERATED_BATCH_PATTERN);
  return match?.[1] || fallback;
};

export const resolveLegacyBatchRoot = (value) => String(value || '').trim().replace(/-\d{2}$/i, '');

export const normalizeBatchBrandPrefix = ({ brand = '', productName = '', fallback = 'MARKA' } = {}) => {
  const source = String(brand || '').trim() || String(productName || '').trim().split(/\s+/)[0] || fallback;
  const ascii = source
    .replace(/[ÇĞİÖŞÜçğıiöşü]/g, (char) => TURKISH_CHAR_MAP[char] || char)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

  return (ascii || fallback).slice(0, 12);
};

export const deterministicBatchCode = (seed, length = 6) => {
  const digest = createHash('sha256').update(String(seed || '')).digest();
  let value = BigInt(`0x${digest.subarray(0, 12).toString('hex')}`);
  let output = '';

  for (let index = 0; index < length; index += 1) {
    const alphabetIndex = Number(value % BigInt(CODE_ALPHABET.length));
    output += CODE_ALPHABET[alphabetIndex];
    value /= BigInt(CODE_ALPHABET.length);
  }

  return output;
};

export const createPublicBatchNo = ({
  brand = '',
  productName = '',
  seed = '',
  sequence = '01',
  codeLength = 6,
} = {}) => {
  const prefix = normalizeBatchBrandPrefix({ brand, productName });
  const core = deterministicBatchCode(seed || `${prefix}-${Date.now()}`, codeLength);
  const safeSequence = String(sequence || '01').padStart(2, '0').slice(-2);
  return `${prefix}-${core}-${safeSequence}`;
};

export const createPublicBatchNoFromLegacy = ({
  legacyBatchNo = '',
  brand = '',
  productName = '',
  productId = '',
  salt = 0,
} = {}) => {
  const root = resolveLegacyBatchRoot(legacyBatchNo);
  return createPublicBatchNo({
    brand,
    productName,
    seed: `${productId}|${root}|${salt}`,
    sequence: resolveLegacyBatchSequence(legacyBatchNo),
  });
};
