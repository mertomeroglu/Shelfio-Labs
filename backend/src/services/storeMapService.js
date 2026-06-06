import { settingsRepo } from '../repositories/settingsRepository.js';
import { sectionRepo } from '../repositories/sectionRepository.js';
import { productRepo } from '../repositories/productRepository.js';
import { isActiveRetailProduct } from '../utils/retailStockPolicy.js';

const MAP_CANVAS = {
  width: 1200,
  height: 760,
  gridColumns: 5,
  gridRows: 3,
  blockWidth: 32,
  blockHeight: 460,
  blockGapX: 42,
  blockGapY: 28,
  originX: 80,
  originY: 120,
};

const normalizeReyonCode = (value) => String(value || '').trim().toUpperCase().replace(/\s+/g, '').replace(/[^A-Z0-9\-]/g, '');
const isDepotCode = (value) => /^D\d+/i.test(String(value || '').trim());

const parseReyonCode = (value) => {
  const normalized = normalizeReyonCode(value);
  if (!normalized || isDepotCode(normalized)) return null;

  let match = normalized.match(/^(\d+)([LR])(\d+)(?:-(\d+))?$/);
  if (match) {
    return {
      normalized,
      sectionNumber: Number(match[1]),
      side: match[2],
      shelfNo: Number(match[3]),
      levelNo: match[4] ? Number(match[4]) : null,
    };
  }

  match = normalized.match(/^R?0*(\d+)-?([LR])-?0*(\d+)(?:-?0*(\d+))?$/);
  if (match) {
    const sectionNumber = Number(match[1]);
    if (!Number.isFinite(sectionNumber) || sectionNumber <= 0) return null;
    return {
      normalized,
      sectionNumber,
      side: match[2],
      shelfNo: Number(match[3] || 1),
      levelNo: match[4] ? Number(match[4]) : null,
    };
  }

  return null;
};

const buildSectionBlocks = (sections) => {
  return sections.map((section, index) => {
    const sectionNumber = Number(section.number || index + 1) || index + 1;
    const column = index;
    return {
      id: `section-${sectionNumber}`,
      label: `Reyon ${sectionNumber}`,
      type: 'shelf',
      x: MAP_CANVAS.originX + (column * (MAP_CANVAS.blockWidth + MAP_CANVAS.blockGapX)),
      y: MAP_CANVAS.originY,
      width: MAP_CANVAS.blockWidth,
      height: MAP_CANVAS.blockHeight,
      reyonCode: String(sectionNumber).padStart(2, '0'),
      customerVisibleName: section.name || `Reyon ${sectionNumber}`,
      sectionId: section.id,
      sectionNumber,
    };
  });
};

const buildAisles = () => { return []; };

const buildEntrances = () => ([{ id: 'entrance-main', label: 'Giris', x: 570, y: 20 }]);

const buildExits = () => ([{ id: 'exit-main', label: 'Cikis', x: 570, y: 700 }]);

const buildCashiers = (settings) => {
  const cashiers = [];
  const exitX = 570;
  const cashierY = 630;
  for (let i = 0; i < 4; i++) {
    cashiers.push({ id: `cashier-B${i + 1}`, label: `Kasa B${i + 1}`, x: exitX - 50 - ((3 - i) * 70), y: cashierY, status: 'open' });
  }
  for (let i = 0; i < 4; i++) {
    cashiers.push({ id: `cashier-B${i + 5}`, label: `Kasa B${i + 5}`, x: exitX + 60 + 20 + (i * 70), y: cashierY, status: 'open' });
  }
  return cashiers;
};

const buildReyonMappings = (sectionBlocks) => {
  const mappings = [];

  for (const block of sectionBlocks) {
    for (const side of ['L', 'R']) {
      for (let shelfNo = 1; shelfNo <= 10; shelfNo += 1) {
        for (let levelNo = 1; levelNo <= 5; levelNo += 1) {
          mappings.push({
            reyonCode: normalizeReyonCode(`${block.sectionNumber}${side}${shelfNo}-${levelNo}`),
            blockId: block.id,
            label: block.label,
            customerVisibleName: block.customerVisibleName,
          });
        }
      }
    }
  }

  return mappings;
};

const buildSectionBlocksFromProducts = (products = []) => {
  const bySectionNumber = new Map();
  for (const product of products) {
    const candidateCodes = [
      product?.shelfCode,
      product?.defaultShelfLocationCode,
      product?.customerLocation,
      product?.locationCode,
    ];
    let parsed = null;
    for (const code of candidateCodes) {
      parsed = parseReyonCode(code);
      if (parsed) break;
    }
    if (!parsed) continue;
    const key = String(parsed.sectionNumber);
    if (!bySectionNumber.has(key)) {
      bySectionNumber.set(key, {
        number: parsed.sectionNumber,
        name: `Reyon ${parsed.sectionNumber}`,
        isActive: true,
        id: `inferred-sec-${parsed.sectionNumber}`,
      });
    }
  }

  const inferredSections = Array.from(bySectionNumber.values())
    .sort((left, right) => Number(left.number || 0) - Number(right.number || 0));
  return buildSectionBlocks(inferredSections);
};

const buildProductDrivenMappings = (products = [], sectionBlocks = []) => {
  const blockBySection = new Map(sectionBlocks.map((block) => [String(block.sectionNumber || ''), block]));
  const dedupe = new Map();

  for (const product of products) {
    const candidateCodes = [
      product?.shelfCode,
      product?.defaultShelfLocationCode,
      product?.customerLocation,
      product?.locationCode,
    ];
    for (const code of candidateCodes) {
      const parsed = parseReyonCode(code);
      if (!parsed) continue;
      const block = blockBySection.get(String(parsed.sectionNumber));
      if (!block) continue;
      const canonical = `${parsed.sectionNumber}${parsed.side}${Math.max(1, parsed.shelfNo)}${parsed.levelNo ? `-${Math.max(1, parsed.levelNo)}` : ''}`;
      const variants = new Set([
        parsed.normalized,
        normalizeReyonCode(canonical),
        normalizeReyonCode(`R${String(parsed.sectionNumber).padStart(2, '0')}-${parsed.side}-${String(Math.max(1, parsed.shelfNo)).padStart(2, '0')}${parsed.levelNo ? `-${String(Math.max(1, parsed.levelNo)).padStart(2, '0')}` : ''}`),
      ]);
      variants.forEach((variant) => {
        if (!variant || isDepotCode(variant)) return;
        dedupe.set(variant, {
          reyonCode: variant,
          blockId: block.id,
          label: block.label,
          customerVisibleName: block.customerVisibleName,
        });
      });
      break;
    }
  }

  return Array.from(dedupe.values());
};

const hasRenderableStoreMap = (config = {}) => {
  const blockCount = Array.isArray(config?.blocks) ? config.blocks.length : 0;
  const entranceCount = Array.isArray(config?.entrances) ? config.entrances.length : 0;
  const exitCount = Array.isArray(config?.exits) ? config.exits.length : 0;
  const cashierCount = Array.isArray(config?.cashiers) ? config.cashiers.length : 0;
  const mappingCount = Array.isArray(config?.reyonMappings) ? config.reyonMappings.length : 0;
  return blockCount > 0 && entranceCount > 0 && exitCount > 0 && cashierCount > 0 && mappingCount > 0;
};

const buildSampleCartEntries = (products = [], reyonMappings = [], maxItems = 10) => {
  const mappingByCode = new Map((Array.isArray(reyonMappings) ? reyonMappings : []).map((row) => [normalizeReyonCode(row.reyonCode), row]));
  const picked = [];

  const simpleHash = (str) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash);
  };

  const sortedProducts = [...products].sort((a, b) => simpleHash(String(a.id)) - simpleHash(String(b.id)));

  for (const product of sortedProducts) {
    const candidates = [
      product?.shelfCode,
      product?.defaultShelfLocationCode,
      product?.customerLocation,
      product?.locationCode,
    ];
    
    let matched = null;
    let finalCode = '';
    
    for (const code of candidates) {
      const parsed = parseReyonCode(code);
      if (!parsed) continue;
      const mapping = mappingByCode.get(parsed.normalized);
      if (!mapping) continue;
      matched = { code: parsed.normalized, blockId: mapping.blockId };
      finalCode = parsed.normalized;
      break;
    }
    
    if (!matched) {
      // Create a deterministic realistic location if none exists
      const hash = simpleHash(String(product.id || ''));
      const sectionBlocks = Array.isArray(reyonMappings) ? Array.from(new Set(reyonMappings.map(r => r.blockId))) : [];
      if (sectionBlocks.length > 0) {
        const blockId = sectionBlocks[hash % sectionBlocks.length];
        const blockNumMatch = blockId.match(/\d+/);
        const sectionNum = blockNumMatch ? blockNumMatch[0] : '1';
        const side = hash % 2 === 0 ? 'L' : 'R';
        const row = (hash % 10) + 1; // 1 to 10
        const level = ((hash >> 2) % 5) + 1; // 1 to 5
        finalCode = normalizeReyonCode(`${sectionNum}${side}${row}-${level}`);
        matched = { code: finalCode, blockId };
      }
    }
    
    if (!matched) continue;

    picked.push({
      id: `sample-${product.id}`,
      quantity: (simpleHash(String(product.id)) % 3) + 1,
      product: {
        id: product.id,
        productName: product.name || product.productName || product.sku || 'Ürün',
        name: product.name || product.productName || product.sku || 'Ürün',
        sku: product.sku || `SKU-${String(product.id).substring(0,6)}`,
        currentPrice: Number(product.salePrice || product.currentPrice || product.price || 0) || 0,
        shelfCode: finalCode,
        defaultShelfLocationCode: finalCode,
        locationCode: finalCode,
        customerLocation: finalCode,
        sectionId: product.sectionId || null,
      },
    });
    if (picked.length >= maxItems) break;
  }

  return picked;
};

export const storeMapService = {
  async getCustomerStoreMap() {
    const [settings, sections, products] = await Promise.all([
      settingsRepo.getSettings(),
      sectionRepo.getAll(),
      productRepo.getAll(),
    ]);

    const activeSections = (Array.isArray(sections) ? sections : [])
      .filter((section) => section?.isActive !== false)
      .sort((left, right) => Number(left.number || 0) - Number(right.number || 0));

    const sourceSections = activeSections.length
      ? activeSections
      : (Array.isArray(sections) ? sections : []).sort((left, right) => Number(left.number || 0) - Number(right.number || 0));

    const retailProducts = (Array.isArray(products) ? products : []).filter(isActiveRetailProduct);
    const sectionBlocksFromSections = sourceSections.length ? buildSectionBlocks(sourceSections) : [];
    const sectionBlocksFromProducts = buildSectionBlocksFromProducts(retailProducts);
    const sectionBlocks = sectionBlocksFromSections.length ? sectionBlocksFromSections : sectionBlocksFromProducts;

    if (!sectionBlocks.length) {
      return {
        status: 'unavailable',
        storeId: 'store-main',
        version: String(settings?.updatedAt || '1'),
        entrances: [],
        exits: [],
        cashiers: [],
        aisles: [],
        blocks: [],
        reyonMappings: [],
        sampleCartEntries: [],
        diagnostics: {
          reason: 'no-section-blocks',
          sectionCount: sourceSections.length,
          productCount: retailProducts.length,
        },
      };
    }

    const aisles = buildAisles();
    const entrances = buildEntrances();
    const exits = buildExits();
    const cashiers = buildCashiers();
    const generatedMappings = buildReyonMappings(sectionBlocks);
    const productDrivenMappings = buildProductDrivenMappings(retailProducts, sectionBlocks);
    const mappingByCode = new Map(generatedMappings.map((item) => [item.reyonCode, item]));
    productDrivenMappings.forEach((item) => mappingByCode.set(item.reyonCode, item));
    const reyonMappings = Array.from(mappingByCode.values());

    const payload = {
      status: 'ready',
      storeId: String(settings?.storeId || 'store-main'),
      version: String(settings?.updatedAt || '1'),
      generatedAt: new Date().toISOString(),
      entrances,
      exits,
      cashiers,
      aisles,
      blocks: [
        ...entrances.map((item) => ({ ...item, type: 'entrance', width: 60, height: 40 })),
        ...exits.map((item) => ({ ...item, type: 'exit', width: 60, height: 40 })),
        ...cashiers.map((item) => ({ ...item, type: 'cashier', width: 60, height: 34 })),
        ...aisles,
        ...sectionBlocks,
      ],
      reyonMappings,
      sampleCartEntries: buildSampleCartEntries(retailProducts, reyonMappings, 3),
      diagnostics: {
        sectionCount: sourceSections.length,
        productCount: retailProducts.length,
        sectionBlocksFrom: sectionBlocksFromSections.length ? 'sections' : 'products',
      },
    };

    if (hasRenderableStoreMap(payload)) {
      return payload;
    }

    return {
      ...payload,
      status: 'unavailable',
      diagnostics: {
        ...(payload.diagnostics || {}),
        reason: 'empty-renderable-core',
      },
    };
  },
  normalizeReyonCode,
};



