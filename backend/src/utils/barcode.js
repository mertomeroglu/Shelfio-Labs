const QR_PREFIXES = ['qr:', 'qrcode:', 'barcode:', 'code:'];

export const normalizeBarcodeInput = (value) => {
  let text = String(value || '').trim();
  if (!text) return '';

  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') {
      text = String(parsed.barcode || parsed.productBarcode || parsed.ean || parsed.gtin || parsed.code || text).trim();
    }
  } catch {
    // Plain barcode, keep going.
  }

  const lower = text.toLowerCase();
  const prefix = QR_PREFIXES.find((item) => lower.startsWith(item));
  if (prefix) text = text.slice(prefix.length).trim();

  text = text.replace(/^'+/, '').trim();
  return text.replace(/[\s-]+/g, '');
};

export const getBarcodeCandidates = (value) => {
  const raw = String(value || '').trim();
  const normalized = normalizeBarcodeInput(raw);
  return Array.from(new Set([raw, normalized].filter(Boolean)));
};

export const getProductBarcodeCandidates = (product = {}) => {
  const payload = product?.payload && typeof product.payload === 'object' ? product.payload : {};
  const nestedPayload = payload.payload && typeof payload.payload === 'object' ? payload.payload : {};
  const values = [
    product.barcode,
    product.ean,
    product.gtin,
    product.altBarcode,
    product.supplierBarcode,
    payload.barcode,
    payload.ean,
    payload.gtin,
    payload.altBarcode,
    payload.supplierBarcode,
    nestedPayload.barcode,
    nestedPayload.ean,
    nestedPayload.gtin,
    ...(Array.isArray(product.barcodes) ? product.barcodes : []),
    ...(Array.isArray(payload.barcodes) ? payload.barcodes : []),
  ];
  return values.flatMap(getBarcodeCandidates);
};

export const getSupplierProductBarcodeCandidates = (supplierProduct = {}) => {
  const payload = supplierProduct?.payload && typeof supplierProduct.payload === 'object' ? supplierProduct.payload : {};
  const nestedPayload = payload.payload && typeof payload.payload === 'object' ? payload.payload : {};
  const values = [
    supplierProduct.barcode,
    supplierProduct.ean,
    supplierProduct.gtin,
    supplierProduct.altBarcode,
    supplierProduct.supplierBarcode,
    payload.barcode,
    payload.ean,
    payload.gtin,
    payload.altBarcode,
    payload.supplierBarcode,
    nestedPayload.barcode,
    nestedPayload.ean,
    nestedPayload.gtin,
    ...(Array.isArray(supplierProduct.barcodes) ? supplierProduct.barcodes : []),
    ...(Array.isArray(payload.barcodes) ? payload.barcodes : []),
  ];
  return values.flatMap(getBarcodeCandidates);
};
