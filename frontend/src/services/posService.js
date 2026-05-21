import { api } from './api.js';
import { formatReturnReasonLabel } from './formatters.js';
import { SUPPORT_CONTACT } from '../constants/contact.js';

const STORE_LEGAL_INFO = {
  companyName: 'Shelfio Magazacilik Ltd. Sti.',
  taxOffice: 'Bornova Vergi Dairesi',
  taxNumber: '1567957351',
  mersisNo: '0274058163400001',
  website: 'www.shelfio.com',
  email: SUPPORT_CONTACT.email,
  phone: '+90 534 271 83 94',
  address: 'Kazımdirik, 372. Sk.',
};

const PAYMENT_LABELS = {
  cash: 'Nakit',
  card: 'Kart',
  qr: 'QR Ödeme',
  eft: 'Havale/EFT',
  giftcard: 'Hediye Kartı',
};

const DESK_LABELS = {
  B1: 'Kasa 1',
  B2: 'Kasa 2',
  B3: 'Kasa 3',
  B4: 'Kasa 4',
  B5: 'Kasa 5',
  B6: 'Kasa 6',
  B7: 'Kasa 7',
  B8: 'Yönetim Kasası',
};

let pdfMakeInstance = null;
let pdfFontsModule = null;

const loadPdfRuntime = async () => {
  if (pdfMakeInstance && pdfFontsModule) {
    return { pdfMake: pdfMakeInstance, pdfFonts: pdfFontsModule };
  }

  const [{ default: pdfMake }, pdfFontsImport] = await Promise.all([
    import('pdfmake/build/pdfmake'),
    import('pdfmake/build/vfs_fonts'),
  ]);
  pdfMakeInstance = pdfMake;
  pdfFontsModule = pdfFontsImport.default || pdfFontsImport;
  return { pdfMake: pdfMakeInstance, pdfFonts: pdfFontsModule };
};

const resolveEmbeddedPdfVfs = (pdfFonts) => {
  const nestedVfs = pdfFonts?.pdfMake?.vfs || pdfFonts?.vfs || pdfFonts?.default?.pdfMake?.vfs || pdfFonts?.default?.vfs;
  if (nestedVfs && Object.keys(nestedVfs).length > 0) {
    return nestedVfs;
  }

  const rawFontMap = pdfFonts && typeof pdfFonts === 'object' ? pdfFonts : {};
  const directFontEntries = Object.entries(rawFontMap).filter(([key, value]) => key.toLowerCase().endsWith('.ttf') && typeof value === 'string');
  return directFontEntries.length ? Object.fromEntries(directFontEntries) : {};
};

const ensurePdfReady = async () => {
  const { pdfMake, pdfFonts } = await loadPdfRuntime();
  const embeddedVfs = resolveEmbeddedPdfVfs(pdfFonts);
  const hasEmbeddedFonts = Object.keys(embeddedVfs).length > 0;

  if (typeof pdfMake.addVirtualFileSystem === 'function' && hasEmbeddedFonts) {
    pdfMake.addVirtualFileSystem(embeddedVfs);
  } else if ((!pdfMake.vfs || Object.keys(pdfMake.vfs).length === 0) && hasEmbeddedFonts) {
    pdfMake.vfs = embeddedVfs;
  }

  if (!pdfMake.vfs || Object.keys(pdfMake.vfs).length === 0) {
    throw new Error('PDF altyapısı hazırlanamadı. Lütfen sayfayı yenileyip tekrar deneyin.');
  }

  return pdfMake;
};

const formatCurrency = (value) => new Intl.NumberFormat('tr-TR', {
  style: 'currency',
  currency: 'TRY',
  minimumFractionDigits: 2,
}).format(Number(value) || 0);

const formatDateTime = (value) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('tr-TR');
};

const resolveVatRate = (value, fallback = 20) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return fallback;
  return numeric;
};

const extractVatIncluded = (grossAmount, vatRate) => {
  const gross = Number(grossAmount) || 0;
  const safeRate = resolveVatRate(vatRate, 20);
  if (gross <= 0) return 0;
  return gross - (gross / (1 + safeRate / 100));
};

const summarizeVatFromRecord = (record) => {
  const items = Array.isArray(record?.items) ? record.items : [];
  const subtotal = Number(record?.subtotal || 0);
  const totalAmount = Number(record?.totalAmount || 0);
  const discount = Number(record?.discount || 0);
  const discountRatio = subtotal > 0 ? Math.max(0, Math.min((subtotal - discount) / subtotal, 1)) : 1;

  const rawVatAmount = items.reduce((sum, item) => {
    const lineTotal = Number(item?.totalPrice || ((Number(item?.unitPrice) || 0) * (Number(item?.quantity) || 0)));
    return sum + extractVatIncluded(lineTotal, item?.vatRate);
  }, 0);

  const adjustedVatAmount = rawVatAmount * discountRatio;
  const vatAmount = Number.isFinite(adjustedVatAmount) ?
    Math.max(0, adjustedVatAmount)
    : Math.max(0, extractVatIncluded(totalAmount, 20));
  const subtotalExcludingVat = Math.max(0, totalAmount - vatAmount);

  return {
    vatAmount,
    subtotalExcludingVat,
  };
};

const buildPaymentText = (record) => {
  const paymentRows = (record.payments || []).map((payment) => {
    const label = PAYMENT_LABELS[payment.method] || payment.method || 'Ödeme';
    return `${label}: ${formatCurrency(payment.amount)}`;
  });

  if (paymentRows.length > 0) {
    return paymentRows.join(' | ');
  }

  return PAYMENT_LABELS[record.paymentMethod] || record.paymentMethod || '-';
};

const buildReceiptDocDefinition = (record, options = {}) => {
  const vatSummary = summarizeVatFromRecord(record);
  const deskCode = record.deskCode || options.deskCode || '';
  const deskLabel = DESK_LABELS[deskCode] || deskCode || '-';
  const paymentSummary = buildPaymentText(record);

  const itemRows = (record.items || []).map((item) => ([
    {
      text: [
        { text: `${item.name || '-'}\n`, bold: true },
        { text: `${Number(item.quantity || 0)} x ${formatCurrency(item.unitPrice)}`, color: '#64748b' },
      ],
      margin: [0, 1, 0, 1],
    },
    { text: formatCurrency(item.totalPrice), alignment: 'right', margin: [0, 5, 0, 0] },
  ]));

  return {
    pageSize: { width: 226.77, height: 'auto' },
    pageMargins: [12, 12, 12, 12],
    defaultStyle: {
      font: 'Roboto',
      fontSize: 8,
      color: '#0f172a',
    },
    content: [
      { text: STORE_LEGAL_INFO.companyName, style: 'title' },
      { text: STORE_LEGAL_INFO.address, style: 'metaCenter' },
      { text: `Tel: ${STORE_LEGAL_INFO.phone}`, style: 'metaCenter' },
      { text: `VKN: ${STORE_LEGAL_INFO.taxNumber}`, style: 'metaCenter' },
      { text: `Fiş Türü: ${record.type === 'return' ? 'Perakende İade Fişi' : 'Perakende Satış Fişi'}`, style: 'sectionTitle' },
      { text: `Fiş No: ${record.referenceNo || '-'}` },
      { text: `Tarih: ${formatDateTime(record.createdAt)}` },
      { text: `Kasa: ${deskLabel}` },
      { text: `Kasiyer: ${record.cashierName || '-'}` },
      ...(record.originalSaleRef ? [{ text: `Orijinal Fiş: ${record.originalSaleRef}` }] : []),
      ...(record.returnReason ? [{ text: `İade Nedeni: ${record.returnReasonLabel || formatReturnReasonLabel(record.returnReason)}` }] : []),
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 200, y2: 0, lineWidth: 0.8, lineColor: '#94a3b8', dash: { length: 2 } }], margin: [0, 5, 0, 5] },
      {
        table: {
          widths: ['*', 62],
          body: [
            [
              { text: 'Ürün', style: 'th' },
              { text: 'Toplam', style: 'th', alignment: 'right' },
            ],
            ...itemRows,
          ],
        },
        layout: {
          hLineColor: '#e2e8f0',
          vLineWidth: () => 0,
          hLineWidth: (i) => (i === 0 ? 0.7 : 0.4),
          paddingLeft: () => 0,
          paddingRight: () => 0,
          paddingTop: () => 1,
          paddingBottom: () => 1,
        },
      },
      {
        margin: [0, 7, 0, 0],
        table: {
          widths: ['*', 'auto'],
          body: [
            ['Ara Toplam', formatCurrency(record.subtotal)],
            ['KDV Matrah', formatCurrency(vatSummary.subtotalExcludingVat)],
            ['KDV Tutarı', formatCurrency(vatSummary.vatAmount)],
            ...(record.discount > 0 ? [['İndirim', `-${formatCurrency(record.discount)}`]] : []),
            [{ text: 'TOPLAM', bold: true }, { text: formatCurrency(record.totalAmount), bold: true }],
          ],
        },
        layout: 'noBorders',
      },
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 200, y2: 0, lineWidth: 0.8, lineColor: '#94a3b8', dash: { length: 2 } }], margin: [0, 5, 0, 5] },
      { text: `Ödeme Bilgileri: ${paymentSummary}`, margin: [0, 0, 0, 2] },
      ...(record.changeAmount > 0 ? [{ text: `Para Üstü: ${formatCurrency(record.changeAmount)}` }] : []),
      { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 200, y2: 0, lineWidth: 0.8, lineColor: '#94a3b8', dash: { length: 2 } }], margin: [0, 5, 0, 5] },
      { text: 'Bu belge elektronik ortamda oluşturulmuştur.', style: 'metaCenter' },
      { text: 'Bizi tercih ettiğiniz için teşekkür ederiz.', style: 'metaCenterSmall' },
    ],
    styles: {
      title: { alignment: 'center', fontSize: 11, bold: true },
      sectionTitle: { fontSize: 8, bold: true, margin: [0, 2, 0, 2] },
      th: { bold: true, color: '#334155', fontSize: 8 },
      metaCenter: { alignment: 'center', color: '#475569', fontSize: 8 },
      metaCenterSmall: { alignment: 'center', color: '#64748b', fontSize: 7 },
    },
  };
};

const buildInvoiceDocDefinition = (record, options = {}) => {
  const kdvRate = 20;
  const vatSummary = summarizeVatFromRecord(record);
  const invoiceNo = `EAR${String(record.referenceNo || '').replace(/[^0-9]/g, '') || Date.now()}`;
  const totalAmount = Number(record.totalAmount || 0);
  const subtotalBeforeKdv = vatSummary.subtotalExcludingVat;
  const kdvAmount = vatSummary.vatAmount;
  const paymentSummary = buildPaymentText(record);
  const deskCode = record.deskCode || options.deskCode || '';
  const deskLabel = DESK_LABELS[deskCode] || deskCode || '-';

  const itemRows = (record.items || []).map((item, index) => {
    const lineTotal = Number(item.totalPrice || 0);
    const lineVatRate = resolveVatRate(item?.vatRate, kdvRate);
    const lineKdv = extractVatIncluded(lineTotal, lineVatRate);
    return [
      { text: String(index + 1), alignment: 'center' },
      { text: item.name || '-' },
      { text: String(item.quantity || 0), alignment: 'center' },
      { text: 'Adet', alignment: 'center' },
      { text: formatCurrency(item.unitPrice), alignment: 'right' },
      { text: `%${lineVatRate}`, alignment: 'right' },
      { text: formatCurrency(lineKdv), alignment: 'right' },
      { text: formatCurrency(lineTotal), alignment: 'right' },
    ];
  });

  return {
    pageSize: 'A4',
    pageMargins: [32, 28, 32, 28],
    defaultStyle: {
      font: 'Roboto',
      color: '#0f172a',
      fontSize: 10,
    },
    content: [
      {
        columns: [
          [
            { text: 'e-ARSIV FATURA', style: 'invoiceTitle' },
            { text: 'Elektronik Ticari Belge', style: 'invoiceSub' },
          ],
          [
            { text: `Fatura No: ${invoiceNo}`, alignment: 'right', bold: true },
            { text: `Tarih: ${formatDateTime(record.createdAt)}`, alignment: 'right' },
            { text: `Belge Türü: ${record.type === 'return' ? 'Satış İade Faturası' : 'Satış Faturası'}`, alignment: 'right' },
            { text: `Kasa: ${deskLabel}`, alignment: 'right' },
          ],
        ],
      },
      {
        margin: [0, 14, 0, 12],
        columns: [
          {
            width: '*',
            stack: [
              { text: 'SATICI', style: 'boxTitle' },
              { text: `Firma: ${STORE_LEGAL_INFO.companyName}` },
              { text: `Vergi Dairesi: ${STORE_LEGAL_INFO.taxOffice}` },
              { text: `VKN/TCKN: ${STORE_LEGAL_INFO.taxNumber}` },
              { text: `MERSIS No: ${STORE_LEGAL_INFO.mersisNo}` },
              { text: `Adres: ${STORE_LEGAL_INFO.address}` },
              { text: `Telefon: ${STORE_LEGAL_INFO.phone}` },
              { text: `E-posta: ${STORE_LEGAL_INFO.email}` },
              { text: `Web: ${STORE_LEGAL_INFO.website}` },
            ],
            margin: [0, 0, 6, 0],
            style: 'metaBox',
          },
          {
            width: '*',
            stack: [
              { text: 'ALICI', style: 'boxTitle' },
              { text: `Firma: ${record.customer?.name || 'Genel Tüketici'}` },
              { text: 'VKN: 1567957351' },
              ...(record.customer?.phone ? [{ text: `Telefon: ${record.customer.phone}` }] : []),
              { text: 'Adres: İzmir / Türkiye' },
            ],
            margin: [6, 0, 0, 0],
            style: 'metaBox',
          },
        ],
      },
      {
        table: {
          headerRows: 1,
          widths: [24, '*', 38, 36, 58, 42, 58, 62],
          body: [
            [
              { text: '#', style: 'tableHeader', alignment: 'center' },
              { text: 'Ürün', style: 'tableHeader' },
              { text: 'Miktar', style: 'tableHeader', alignment: 'center' },
              { text: 'Birim', style: 'tableHeader', alignment: 'center' },
              { text: 'B. Fiyat', style: 'tableHeader', alignment: 'right' },
              { text: 'KDV', style: 'tableHeader', alignment: 'right' },
              { text: 'KDV Tutar', style: 'tableHeader', alignment: 'right' },
              { text: 'Toplam', style: 'tableHeader', alignment: 'right' },
            ],
            ...itemRows,
          ],
        },
        layout: {
          fillColor: (rowIndex) => (rowIndex === 0 ? '#eff6ff' : null),
          hLineColor: '#e2e8f0',
          vLineColor: '#e2e8f0',
        },
      },
      {
        margin: [0, 14, 0, 0],
        columns: [
          { width: '*', text: '' },
          {
            width: 270,
            table: {
              widths: ['*', 'auto'],
              body: [
                ['Ara Toplam (KDV Haric)', formatCurrency(subtotalBeforeKdv)],
                [`KDV (%${kdvRate})`, formatCurrency(kdvAmount)],
                ...(record.discount > 0 ? [['İndirim', `-${formatCurrency(record.discount)}`]] : []),
                [{ text: 'GENEL TOPLAM', bold: true, color: '#1d4ed8' }, { text: formatCurrency(totalAmount), bold: true, color: '#1d4ed8' }],
                ['Ödeme Yöntemi', paymentSummary],
                ['Para Birimi', 'TRY'],
              ],
            },
            layout: 'lightHorizontalLines',
          },
        ],
      },
      {
        margin: [0, 16, 0, 0],
        text: 'Bu belge, 213 sayılı Vergi Usul Kanunu kapsamında elektronik ortamda düzenlenmiştir. Fiziksel imza gerektirmez.',
        style: 'invoiceFooter',
      },
    ],
    styles: {
      invoiceTitle: { fontSize: 20, bold: true, color: '#1d4ed8' },
      invoiceSub: { color: '#64748b', margin: [0, 2, 0, 0] },
      boxTitle: { bold: true, color: '#1d4ed8', margin: [0, 0, 0, 6] },
      metaBox: { margin: [0, 0, 0, 0], fontSize: 9 },
      tableHeader: { bold: true, color: '#334155', fontSize: 9 },
      invoiceFooter: { alignment: 'center', color: '#64748b', fontSize: 8 },
    },
  };
};

export const downloadPosReceiptPdf = async (record, options = {}) => {
  if (!record) {
    throw new Error('Belge verisi bulunamadı.');
  }
  const pdfMake = await ensurePdfReady();
  const fileName = `fis-${record.referenceNo || record.id || 'islem'}.pdf`;
  const docDefinition = buildReceiptDocDefinition(record, options);
  pdfMake.createPdf(docDefinition).download(fileName);
};

export const downloadPosInvoicePdf = async (record, options = {}) => {
  if (!record) {
    throw new Error('Belge verisi bulunamadı.');
  }
  const pdfMake = await ensurePdfReady();
  const fileName = `fatura-${record.referenceNo || record.id || 'islem'}.pdf`;
  const docDefinition = buildInvoiceDocDefinition(record, options);
  pdfMake.createPdf(docDefinition).download(fileName);
};

const unwrapSalesList = (payload) => {
  if (Array.isArray(payload)) return payload;
  const items = Array.isArray(payload?.items) ? payload.items : (Array.isArray(payload?.data) ? payload.data : []);
  try {
    Object.defineProperty(items, 'meta', {
      value: {
        total: payload?.total ?? items.length,
        page: payload?.page ?? 1,
        limit: payload?.limit ?? items.length,
      },
      enumerable: false,
      configurable: true,
    });
  } catch {
    items.meta = {
      total: payload?.total ?? items.length,
      page: payload?.page ?? 1,
      limit: payload?.limit ?? items.length,
    };
  }
  return items;
};

export const posService = {
  getDeskActivationStatus: () => api.get('/pos/desks/activation-status'),
  setDeskActivation: (deskCode, isActive) => api.patch('/pos/desks/activation-status', { deskCode, isActive }),
  getDashboard: () => api.get('/pos/dashboard'),
  getCategories: () => api.get('/pos/categories'),
  getProductsByCategory: (categoryId) => api.get(`/pos/categories/${categoryId}/products`),
  searchProducts: (query) => api.get(`/pos/products/search?q=${encodeURIComponent(query)}`),
  findByBarcode: (barcode) => api.get(`/pos/products/by-barcode/${encodeURIComponent(barcode)}`),
  createAutomaticSale: (payload) => api.post('/pos/sales/automatic', payload),
  completeSale: (payload) => api.post('/pos/sales', payload),
  processReturn: (payload) => api.post('/pos/returns', payload),
  getTodaySales: () => api.get('/pos/sales/today'),
  getAllSales: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return api.get(`/pos/sales/all${qs ? '?' + qs : ''}`).then(unwrapSalesList);
  },
  getSaleById: (id) => api.get(`/pos/sales/${id}`),
  getSaleByReference: (ref) => api.get(`/pos/sales/reference/${encodeURIComponent(ref)}`),
  getDailyReport: (date) => api.get(`/pos/report/daily${date ? '?date=' + date : ''}`),
  downloadReceiptPdf: (record, options) => downloadPosReceiptPdf(record, options),
  downloadInvoicePdf: (record, options) => downloadPosInvoicePdf(record, options),
};
