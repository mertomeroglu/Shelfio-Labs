const MIN_PASSWORD_LENGTH = 8;
const LOWERCASE_PATTERN = /\p{Ll}/u;
const UPPERCASE_PATTERN = /\p{Lu}/u;
const NUMBER_PATTERN = /\p{N}/u;
const SPECIAL_PATTERN = /[^\p{L}\p{N}\s]/u;

export const SSO_PASSWORD_REQUIREMENTS = [
  { id: 'minLength', label: 'En az 8 karakter' },
  { id: 'lowercase', label: 'En az 1 küçük harf' },
  { id: 'uppercase', label: 'En az 1 büyük harf' },
  { id: 'number', label: 'En az 1 rakam' },
  { id: 'special', label: 'En az 1 özel karakter' },
];

export const SSO_PASSWORD_MESSAGE =
  'Şifre en az 8 karakter olmalı; büyük harf, küçük harf, rakam ve özel karakter içermelidir.';

export const evaluateSsoPassword = (password) => {
  const value = String(password || '');
  return {
    minLength: value.length >= MIN_PASSWORD_LENGTH,
    lowercase: LOWERCASE_PATTERN.test(value),
    uppercase: UPPERCASE_PATTERN.test(value),
    number: NUMBER_PATTERN.test(value),
    special: SPECIAL_PATTERN.test(value),
  };
};

export const validateSsoPassword = (password) => {
  const checks = evaluateSsoPassword(password);
  return Object.values(checks).every(Boolean);
};
