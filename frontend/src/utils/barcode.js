const QR_PREFIXES = ['qr:', 'qrcode:', 'barcode:', 'code:'];

export function normalizeBarcodeInput(value) {
  let text = String(value || '').trim();
  if (!text) return '';

  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') {
      text = String(
        parsed.barcode
        || parsed.productBarcode
        || parsed.ean
        || parsed.gtin
        || parsed.supplierBarcode
        || parsed.altBarcode
        || parsed.code
        || text
      ).trim();
    }
  } catch {
    // Plain scanner/manual input.
  }

  const lower = text.toLowerCase();
  const prefix = QR_PREFIXES.find((item) => lower.startsWith(item));
  if (prefix) text = text.slice(prefix.length).trim();

  text = text.replace(/^'+/, '').trim();
  return text.replace(/[\s-]+/g, '');
}

export function getBarcodeCandidates(value) {
  const raw = String(value || '').trim();
  const normalized = normalizeBarcodeInput(raw);
  return Array.from(new Set([raw, normalized].filter(Boolean)));
}
