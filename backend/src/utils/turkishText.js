const MOJIBAKE_PATTERN = /(?:Ã.|Å.|Ä.|â.|¤|�)/u;

const countPattern = (value, pattern) => {
  const matches = String(value || '').match(pattern);
  return matches ? matches.length : 0;
};

const looksMisencoded = (value) => MOJIBAKE_PATTERN.test(String(value || ''));

const decodeLatin1AsUtf8 = (value) => {
  try {
    return Buffer.from(String(value || ''), 'latin1').toString('utf8');
  } catch {
    return String(value || '');
  }
};

const scoreText = (value) => {
  const text = String(value || '');
  return (
    (countPattern(text, /(?:Ã.|Å.|Ä.|â.|¤)/gu) * 4)
    + (countPattern(text, /�/gu) * 6)
  );
};

export const normalizeTurkishText = (value) => {
  const original = String(value ?? '');
  if (!original || !looksMisencoded(original)) {
    return original;
  }

  let current = original;
  let currentScore = scoreText(original);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const candidate = decodeLatin1AsUtf8(current);
    const candidateScore = scoreText(candidate);
    if (candidateScore >= currentScore) {
      break;
    }
    current = candidate;
    currentScore = candidateScore;
    if (!looksMisencoded(current)) {
      break;
    }
  }

  return current;
};

export const normalizeTurkishTextDeep = (value) => {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeTurkishTextDeep(item));
  }

  if (value && typeof value === 'object') {
    return Object.entries(value).reduce((acc, [key, item]) => {
      acc[key] = normalizeTurkishTextDeep(item);
      return acc;
    }, {});
  }

  return typeof value === 'string' ? normalizeTurkishText(value) : value;
};
