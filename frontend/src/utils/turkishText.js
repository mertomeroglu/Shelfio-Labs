const MOJIBAKE_PATTERN = /(?:\u00c3.|\u00c5.|\u00c4.|\u00e2.|\u00c2.|\ufffd|\u00ef\u00bf\u00bd)/u;

const DIRECT_TURKISH_REPLACEMENTS = [
  ['\u00c3\u0153', '\u00dc'],
  ['\u00c3\u009c', '\u00dc'],
  ['\u00c3\u2013', '\u00d6'],
  ['\u00c3\u0096', '\u00d6'],
  ['\u00c3\u2021', '\u00c7'],
  ['\u00c3\u0087', '\u00c7'],
  ['\u00c3\u00bc', '\u00fc'],
  ['\u00c3\u00b6', '\u00f6'],
  ['\u00c3\u00a7', '\u00e7'],
  ['\u00c4\u00b0', '\u0130'],
  ['\u00c4\u00b1', '\u0131'],
  ['\u00c4\u009f', '\u011f'],
  ['\u00c4\u0178', '\u011f'],
  ['\u00c4\u009e', '\u011e'],
  ['\u00c4\u017e', '\u011e'],
  ['\u00c5\u009f', '\u015f'],
  ['\u00c5\u0178', '\u015f'],
  ['\u00c5\u009e', '\u015e'],
  ['\u00c5\u017e', '\u015e'],
  ['\u00e2\u20ac\u00a2', '\u2022'],
  ['\u00e2\u0080\u00a2', '\u2022'],
  ['\u00e2\u20ac\u201c', '-'],
  ['\u00e2\u0080\u0093', '-'],
  ['\u00e2\u20ac\u201d', '-'],
  ['\u00e2\u0080\u0094', '-'],
  ['\u00e2\u20ac\u2122', "'"],
  ['\u00e2\u0080\u0099', "'"],
  ['\u00e2\u20ac\u02dc', "'"],
  ['\u00e2\u0080\u0098', "'"],
  ['\u00e2\u20ac\u0153', '"'],
  ['\u00e2\u0080\u009c', '"'],
  ['\u00e2\u20ac\u009d', '"'],
  ['\u00e2\u0080\u009d', '"'],
  ['\u00c2\u00b0', '\u00b0'],
  ['\u00c2\u00b7', '\u00b7'],
  ['\u00c2', ''],
  ['\u00ef\u00bf\u00bd', ''],
  ['\ufffd', ''],
];

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
    (countPattern(text, /(?:\u00c3.|\u00c5.|\u00c4.|\u00e2.|\u00c2.)/gu) * 4)
    + (countPattern(text, /(?:\ufffd|\u00ef\u00bf\u00bd)/gu) * 6)
  );
};

const applyDirectTurkishReplacements = (value) => DIRECT_TURKISH_REPLACEMENTS.reduce(
  (text, [wrong, correct]) => text.split(wrong).join(correct),
  String(value || ''),
);

export const normalizeTurkishText = (value) => {
  const original = String(value ?? '');
  if (!original) return original;

  let current = applyDirectTurkishReplacements(original);
  if (!looksMisencoded(current)) {
    return current;
  }

  let currentScore = scoreText(current);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const candidate = applyDirectTurkishReplacements(decodeLatin1AsUtf8(current));
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

  return applyDirectTurkishReplacements(current);
};
