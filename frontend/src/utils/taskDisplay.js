const BATCH_SKT_PATTERN = /\s*batch\s+([A-Z0-9-]+)\s+SKT\s+(\d{4}-\d{2}-\d{2})(?:\.)?\s*$/i;

const normalizeText = (value) => String(value || '').trim();

export const formatSktDate = (value) => {
  const text = normalizeText(value);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return `${match[3]}.${match[2]}.${match[1]}`;
  }

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleDateString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
};

export const extractTaskBatchSkt = (task = {}) => {
  const payload = task.payload && typeof task.payload === 'object' ? task.payload : {};
  const rawDescription = normalizeText(task.description);
  const descriptionMatch = rawDescription.match(BATCH_SKT_PATTERN);

  const batchNo = normalizeText(payload.batchNo || payload.batch || task.batchNo || task.batch || descriptionMatch?.[1]);
  const skt = normalizeText(payload.skt || payload.expiryDate || payload.expirationDate || task.skt || task.expiryDate || descriptionMatch?.[2]);

  if (!batchNo && !skt) return null;

  const productName = normalizeText(
    payload.productName ||
    payload.product?.name ||
    task.productName ||
    (descriptionMatch ? rawDescription.replace(BATCH_SKT_PATTERN, '') : '')
  );

  return {
    batchNo,
    skt,
    productName,
  };
};

export const formatTaskDisplayTitle = (task = {}) => {
  const batchSkt = extractTaskBatchSkt(task);
  if (!batchSkt) return task.title || 'Görev';

  const productSuffix = batchSkt.productName ? ` • ${batchSkt.productName}` : '';
  return `SKT Kontrolü${productSuffix}`;
};

export const formatTaskDisplayDescription = (task = {}) => {
  const batchSkt = extractTaskBatchSkt(task);
  if (!batchSkt) return task.description || '';

  return [
    batchSkt.productName ? `Ürün: ${batchSkt.productName}` : '',
    batchSkt.batchNo ? `Parti No: ${batchSkt.batchNo}` : '',
    batchSkt.skt ? `SKT: ${formatSktDate(batchSkt.skt)}` : '',
  ].filter(Boolean).join('\n');
};
