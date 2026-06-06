import { eslService } from './eslService.js';
import { productService } from './productService.js';
import { normalizeBarcodeInput } from '../utils/barcode.js';

function normalizeScanValue(value) {
  return normalizeBarcodeInput(value);
}

function maybeParseQrPayload(value) {
  const raw = String(value || '').trim();
  const normalized = normalizeScanValue(raw);
  if (!normalized) return {};

  if (raw.startsWith('{') && raw.endsWith('}')) {
    try {
      const parsed = JSON.parse(raw);
      return {
        raw,
        normalized: normalizeScanValue(
          parsed.barcode
          || parsed.productBarcode
          || parsed.ean
          || parsed.gtin
          || parsed.deviceId
          || parsed.eslDeviceId
          || parsed.code
          || normalized
        ),
        payload: parsed,
      };
    } catch {
      return { raw, normalized };
    }
  }

  return { raw, normalized };
}

async function findProductByBarcode(barcode) {
  const normalized = normalizeScanValue(barcode);
  if (!normalized) {
    throw new Error('Lütfen barkod girin.');
  }
  return productService.findByBarcode(normalized);
}

async function resolveLabelScan(scanValue, options = {}) {
  const { products = [], devices = [] } = options;
  const parsed = maybeParseQrPayload(scanValue);
  const token = normalizeScanValue(parsed.normalized || scanValue);

  if (!token) {
    return { kind: 'none', token: '', parsed };
  }

  const payload = parsed.payload || {};

  const productToken = normalizeScanValue(
    payload.barcode || payload.productBarcode || payload.product_code || payload.sku || payload.productSku || token
  );

  const deviceToken = normalizeScanValue(
    payload.deviceId || payload.eslDeviceId || payload.esl_id || payload.mac || payload.macAddress || token
  );

  const matchProduct = products.find((item) =>
    normalizeScanValue(item.barcode) === productToken ||
    String(item.sku || '').trim().toLowerCase() === productToken.toLowerCase()
  );

  if (matchProduct) {
    return { kind: 'product', token, parsed, product: matchProduct };
  }

  const loweredDeviceToken = deviceToken.toLowerCase();
  const matchDevice = devices.find((device) => {
    const candidates = [
      device.id,
      device.macAddress,
      device.name,
      device.location,
      device.assignedProductId,
    ]
      .filter(Boolean)
      .map((entry) => String(entry).trim().toLowerCase());

    return candidates.some((entry) => entry === loweredDeviceToken);
  });

  if (matchDevice) {
    const linkedProduct = matchDevice.assignedProductId
      ? products.find((item) => item.id === matchDevice.assignedProductId) || null
      : null;

    return {
      kind: 'device',
      token,
      parsed,
      device: matchDevice,
      product: linkedProduct,
    };
  }

  if (token.length >= 8) {
    try {
      const remoteProduct = await productService.findByBarcode(token);
      return { kind: 'product', token, parsed, product: remoteProduct };
    } catch {
      // Local not-found remains useful for ESL/device scans.
    }
  }

  return { kind: 'not-found', token, parsed };
}

async function preloadLabelScanData() {
  const [products, devices] = await Promise.all([
    productService.list({ fetchAll: false, includeListDetails: false, includeTotal: false, limit: 20 }),
    eslService.listDevices(),
  ]);
  return { products, devices };
}

export const barcodeLookupService = {
  normalizeScanValue,
  maybeParseQrPayload,
  findProductByBarcode,
  resolveLabelScan,
  preloadLabelScanData,
};
