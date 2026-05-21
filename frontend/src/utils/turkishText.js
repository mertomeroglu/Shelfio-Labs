const MOJIBAKE_PATTERN = /(?:Ã.|Å.|Ä.|â.|¤|�)/u;

const countPattern = (value, pattern) => {
  const matches = String(value || '').match(pattern);
  return matches ? matches.length : 0;
};

const looksMisencoded = (value) => MOJIBAKE_PATTERN.test(String(value || ''));

const decodeLatin1AsUtf8 = (value) => {
  try {
    const source = String(value || '');
    const bytes = Uint8Array.from(source, (char) => char.charCodeAt(0) & 0xff);
    return new TextDecoder('utf-8').decode(bytes);
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
