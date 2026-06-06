import { getPrisma } from '../../src/providers/postgresProvider.js';
import { resolveSktPolicy, SKT_POLICIES } from '../../src/utils/sktPolicy.js';

const TODAY = '2026-06-03';
const TARGET_DISTRIBUTION = [
  { key: '3', label: '3 gün', pct: 0.10, range: [2, 3] },
  { key: '7', label: '7 gün', pct: 0.10, range: [5, 7] },
  { key: '14', label: '14 gün', pct: 0.10, range: [10, 14] },
  { key: '30', label: '30 gün', pct: 0.20, range: [21, 30] },
  { key: '90', label: '90 gün', pct: 0.10, range: [60, 90] },
  { key: '180', label: '180 gün', pct: 0.20, range: [120, 180] },
  { key: '360', label: '360 gün', pct: 0.20, range: [270, 360] },
];
const TARGET_KEYS = TARGET_DISTRIBUTION.map((item) => item.key);
const TARGET_BY_KEY = new Map(TARGET_DISTRIBUTION.map((item) => [item.key, item]));
const DAY_MS = 24 * 60 * 60 * 1000;

const normalizeText = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase('tr-TR')
  .replace(/ı/g, 'i')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const stableHash = (value) => {
  const text = String(value || '');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const addDays = (dateOnly, days) => {
  const date = new Date(`${dateOnly}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
};

const daysFromToday = (dateOnly) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateOnly || ''))) return null;
  return Math.round((Date.parse(`${dateOnly}T00:00:00.000Z`) - Date.parse(`${TODAY}T00:00:00.000Z`)) / DAY_MS);
};

const bucketForSkt = (skt) => {
  const days = daysFromToday(skt);
  if (days === null) return 'missing';
  if (days < 0) return 'expired';
  if (days <= 3) return '3';
  if (days <= 7) return '7';
  if (days <= 14) return '14';
  if (days <= 30) return '30';
  if (days <= 90) return '90';
  if (days <= 180) return '180';
  if (days <= 360) return '360';
  return 'gt360';
};

const makeCounter = (keys = [...TARGET_KEYS, 'expired', 'missing', 'gt360']) =>
  Object.fromEntries(keys.map((key) => [key, 0]));

const increment = (counter, key, by = 1) => {
  counter[key] = (counter[key] || 0) + by;
};

const classifyGuardrail = (row) => {
  const code = String(row.categoryCode || '').trim().toLocaleUpperCase('tr-TR');
  const categoryName = normalizeText(row.categoryName);
  const productName = normalizeText(row.productName);
  const label = normalizeText(row.etiket);
  const combined = `${categoryName} ${productName} ${label}`;

  if (code === 'MYSBZ' || code === 'FRPST' || code === 'ETBLK') return 'short';
  if (code === 'SUTKH' && /(sut|ayran|kefir|yogurt|peynir|labne|tereyag|krema|yumurta|gunluk|taze)/.test(combined)) {
    return 'short';
  }
  if (code === 'SUTKH' || code === 'HZYMK') return 'medium';
  if (code === 'ATSRM' || code === 'TMGDA' || code === 'ICECK') return 'long';
  if (code === 'BEBEK' && /mama/.test(combined)) return 'long';
  return 'medium';
};

const allowedBucketsFor = (guardrail) => {
  if (guardrail === 'short') return ['3', '7', '14', '30'];
  if (guardrail === 'long') return ['30', '90', '180', '360'];
  return ['14', '30', '90', '180', '360'];
};

const isActiveListedProduct = (row) => (
  row.isListed !== false
  && row.isActive !== false
  && String(row.catalogVisibility || '').trim().toLowerCase() !== 'catalog_only'
);

const stockIsPositive = (row) => {
  const direct = Number(row.stockOnHand ?? row.stockQuantity ?? row.stockAvailable ?? 0);
  const split = Number(row.stockWarehouseQuantity || 0) + Number(row.stockShelfQuantity || 0);
  return Math.max(direct, split, Number(row.batchTotalQuantity || 0)) > 0;
};

const toProductPolicyPayload = (row) => ({
  id: row.productId,
  name: row.productName,
  productName: row.productName,
  sku: row.sku,
  barcode: row.barcode,
  etiket: row.etiket,
  categoryCode: row.categoryCode,
  categoryName: row.categoryName,
  category: {
    code: row.categoryCode,
    name: row.categoryName,
  },
});

const orderByOldFefo = (left, right) => (
  String(left.oldSkt || '9999-12-31').localeCompare(String(right.oldSkt || '9999-12-31'))
  || String(left.batchNo || '').localeCompare(String(right.batchNo || ''), 'tr')
  || String(left.id || '').localeCompare(String(right.id || ''))
);

const computeTargetCounts = (count) => {
  const raw = TARGET_DISTRIBUTION.map((item) => ({
    ...item,
    exact: count * item.pct,
    value: Math.floor(count * item.pct),
  }));
  let remaining = count - raw.reduce((sum, item) => sum + item.value, 0);
  raw
    .sort((left, right) => (right.exact - right.value) - (left.exact - left.value))
    .forEach((item) => {
      if (remaining <= 0) return;
      item.value += 1;
      remaining -= 1;
    });
  return Object.fromEntries(raw.map((item) => [item.key, item.value]));
};

const chooseBucket = (row, desiredCounts, assignedCounts) => {
  const allowed = allowedBucketsFor(row.guardrail);
  const withDeficit = allowed
    .map((key) => ({
      key,
      deficit: (desiredCounts[key] || 0) - (assignedCounts[key] || 0),
      desired: desiredCounts[key] || 0,
      assigned: assignedCounts[key] || 0,
    }))
    .filter((item) => item.deficit > 0)
    .sort((left, right) => right.deficit - left.deficit || TARGET_KEYS.indexOf(left.key) - TARGET_KEYS.indexOf(right.key));

  if (withDeficit.length) return withDeficit[0].key;

  return allowed
    .map((key) => ({
      key,
      pressure: (assignedCounts[key] || 0) / Math.max(1, desiredCounts[key] || 1),
    }))
    .sort((left, right) => left.pressure - right.pressure || TARGET_KEYS.indexOf(left.key) - TARGET_KEYS.indexOf(right.key))[0].key;
};

const buildAssignments = (eligibleRows) => {
  const desiredCounts = computeTargetCounts(eligibleRows.length);
  const assignedCounts = makeCounter(TARGET_KEYS);
  const sortable = eligibleRows
    .map((row) => ({ ...row }))
    .sort((left, right) => (
      allowedBucketsFor(left.guardrail).length - allowedBucketsFor(right.guardrail).length
      || daysFromToday(left.oldSkt) - daysFromToday(right.oldSkt)
      || stableHash(`${left.productId}:${left.batchNo}:${left.id}`) - stableHash(`${right.productId}:${right.batchNo}:${right.id}`)
    ));

  for (const row of sortable) {
    const key = chooseBucket(row, desiredCounts, assignedCounts);
    row.targetBucket = key;
    increment(assignedCounts, key);
  }

  const byProduct = new Map();
  for (const row of sortable) {
    if (!byProduct.has(row.productId)) byProduct.set(row.productId, []);
    byProduct.get(row.productId).push(row);
  }

  const assignments = new Map();
  for (const rows of byProduct.values()) {
    const oldOrder = [...rows].sort(orderByOldFefo);
    const bucketOrder = [...rows].sort((left, right) => (
      TARGET_KEYS.indexOf(left.targetBucket) - TARGET_KEYS.indexOf(right.targetBucket)
      || orderByOldFefo(left, right)
    ));
    let previousDay = -Infinity;
    oldOrder.forEach((row, index) => {
      const bucket = bucketOrder[index].targetBucket;
      const target = TARGET_BY_KEY.get(bucket);
      const [minDay, maxDay] = target.range;
      const span = maxDay - minDay + 1;
      let actualDay = minDay + (stableHash(`${row.productId}:${row.batchNo}:${row.id}:${bucket}`) % span);
      if (actualDay <= previousDay) actualDay = Math.min(maxDay, previousDay + 1);
      if (actualDay <= previousDay) actualDay = previousDay + 1;
      previousDay = actualDay;
      assignments.set(row.id, {
        targetBucket: bucket,
        newSkt: addDays(TODAY, actualDay),
        newDays: actualDay,
      });
    });
  }

  return { assignments, desiredCounts, assignedCounts };
};

const summarizeDistribution = (rows, field = 'skt') => {
  const counter = makeCounter();
  rows.forEach((row) => increment(counter, bucketForSkt(row[field])));
  return counter;
};

const summarizeCategories = (rows, field = 'skt') => {
  const summary = new Map();
  rows.forEach((row) => {
    const key = row.categoryName || row.categoryCode || 'Kategori yok';
    if (!summary.has(key)) {
      summary.set(key, { category: key, guardrail: row.guardrail, total: 0, distribution: makeCounter(TARGET_KEYS) });
    }
    const item = summary.get(key);
    item.total += 1;
    const bucket = bucketForSkt(row[field]);
    if (TARGET_KEYS.includes(bucket)) increment(item.distribution, bucket);
  });
  return [...summary.values()].sort((left, right) => right.total - left.total || left.category.localeCompare(right.category, 'tr'));
};

const summarizeSameDayTies = (rows, field = 'skt') => {
  const byProduct = new Map();
  rows.forEach((row) => {
    if (!byProduct.has(row.productId)) byProduct.set(row.productId, []);
    byProduct.get(row.productId).push(row);
  });

  let productsWithMultipleBatches = 0;
  let allBatchesSameDayProducts = 0;
  let sameDayTieGroups = 0;
  let sameDayTieBatchRows = 0;

  for (const rowsForProduct of byProduct.values()) {
    if (rowsForProduct.length <= 1) continue;
    productsWithMultipleBatches += 1;
    const uniqueDates = new Set(rowsForProduct.map((row) => row[field] || ''));
    if (uniqueDates.size === 1) allBatchesSameDayProducts += 1;
    const byDate = new Map();
    rowsForProduct.forEach((row) => {
      const date = row[field] || '';
      byDate.set(date, (byDate.get(date) || 0) + 1);
    });
    for (const count of byDate.values()) {
      if (count > 1) {
        sameDayTieGroups += 1;
        sameDayTieBatchRows += count;
      }
    }
  }

  return {
    productsWithMultipleBatches,
    allBatchesSameDayProducts,
    sameDayTieGroups,
    sameDayTieBatchRows,
  };
};

const deriveFefoByProduct = (rows) => {
  const byProduct = new Map();
  rows.forEach((row) => {
    if (!byProduct.has(row.productId)) byProduct.set(row.productId, []);
    byProduct.get(row.productId).push(row);
  });
  const derived = new Map();
  for (const [productId, items] of byProduct.entries()) {
    const nearest = items
      .filter((item) => Number(item.batchTotalQuantity || 0) > 0 && item.skt)
      .sort((left, right) => (
        String(left.skt).localeCompare(String(right.skt))
        || String(left.batchNo || '').localeCompare(String(right.batchNo || ''), 'tr')
        || String(left.id || '').localeCompare(String(right.id || ''))
      ))[0] || null;
    derived.set(productId, {
      stockId: items[0]?.stockId || '',
      nearestExpiry: nearest?.skt || null,
      fefoDefaultExpiry: nearest?.skt || null,
      fefoDefaultBatchNo: nearest?.batchNo || null,
    });
  }
  return derived;
};

const assertNoFefoInversion = (beforeRows, afterRows) => {
  const afterById = new Map(afterRows.map((row) => [row.id, row]));
  const byProduct = new Map();
  beforeRows.forEach((row) => {
    if (!byProduct.has(row.productId)) byProduct.set(row.productId, []);
    byProduct.get(row.productId).push(row);
  });
  const issues = [];
  for (const [productId, rows] of byProduct.entries()) {
    const oldOrder = [...rows].sort(orderByOldFefo);
    for (let index = 1; index < oldOrder.length; index += 1) {
      const previous = afterById.get(oldOrder[index - 1].id);
      const current = afterById.get(oldOrder[index].id);
      if (!previous || !current) continue;
      if (String(previous.skt || '') > String(current.skt || '')) {
        issues.push({
          productId,
          previousBatchNo: previous.batchNo,
          previousSkt: previous.skt,
          currentBatchNo: current.batchNo,
          currentSkt: current.skt,
        });
      }
    }
  }
  return issues;
};

const selectSamples = (beforeRows, afterRows) => {
  const afterById = new Map(afterRows.map((row) => [row.id, row]));
  return beforeRows
    .filter((row) => afterById.has(row.id) && row.oldSkt !== afterById.get(row.id).skt)
    .sort((left, right) => (
      Math.abs(daysFromToday(left.oldSkt) ?? 9999) - Math.abs(daysFromToday(right.oldSkt) ?? 9999)
      || String(left.productName).localeCompare(String(right.productName), 'tr')
    ))
    .slice(0, 10)
    .map((row) => {
      const after = afterById.get(row.id);
      return {
        productName: row.productName,
        sku: row.sku,
        batchNo: row.batchNo,
        category: row.categoryName,
        oldSkt: row.oldSkt,
        newSkt: after.skt,
      };
    });
};

const main = async () => {
  const prisma = await getPrisma();
  const allRowsRaw = await prisma.$queryRaw`
    SELECT
      b.id,
      b.tenant_id AS "tenantId",
      b.stock_id AS "stockId",
      b.product_id AS "productId",
      b.batch_no AS "batchNo",
      b.skt,
      b.total_quantity AS "batchTotalQuantity",
      s.nearest_expiry AS "stockNearestExpiry",
      s.fefo_default_expiry AS "stockFefoDefaultExpiry",
      s.fefo_default_batch_no AS "stockFefoDefaultBatchNo",
      s.warehouse_quantity AS "stockWarehouseQuantity",
      s.shelf_quantity AS "stockShelfQuantity",
      s.quantity AS "stockQuantity",
      s.on_hand AS "stockOnHand",
      s.available AS "stockAvailable",
      p.id AS "joinedProductId",
      p.name AS "productName",
      p.sku,
      p.barcode,
      p.etiket,
      p.is_listed AS "isListed",
      p.is_active AS "isActive",
      p.catalog_visibility AS "catalogVisibility",
      c.name AS "categoryName",
      c.code AS "categoryCode"
    FROM stock_batches b
    JOIN stocks s ON s.id = b.stock_id
    JOIN products p ON p.id = b.product_id
    LEFT JOIN categories c ON c.id = p.category_id
    ORDER BY p.sku ASC, b.skt ASC NULLS LAST, b.batch_no ASC, b.id ASC
  `;

  const allRows = allRowsRaw.map((row) => {
    const policy = resolveSktPolicy({
      product: toProductPolicyPayload(row),
      category: { code: row.categoryCode, name: row.categoryName },
    }).policy;
    const guardrail = classifyGuardrail(row);
    return {
      ...row,
      oldSkt: row.skt || null,
      policy,
      guardrail,
      batchTotalQuantity: Number(row.batchTotalQuantity || 0),
    };
  });

  const eligibleRows = allRows.filter((row) => (
    isActiveListedProduct(row)
    && stockIsPositive(row)
    && Number(row.batchTotalQuantity || 0) > 0
    && row.policy === SKT_POLICIES.REQUIRED
  ));
  const nonRequiredSnapshot = new Map(
    allRows
      .filter((row) => row.policy !== SKT_POLICIES.REQUIRED)
      .map((row) => [row.id, row.oldSkt || null])
  );
  const batchNoSnapshot = new Map(eligibleRows.map((row) => [row.id, row.batchNo || null]));

  const beforeDistribution = summarizeDistribution(eligibleRows, 'oldSkt');
  const expiredBefore = eligibleRows.filter((row) => bucketForSkt(row.oldSkt) === 'expired').length;
  const sameDayBefore = summarizeSameDayTies(eligibleRows.map((row) => ({ ...row, skt: row.oldSkt })));
  const { assignments, desiredCounts, assignedCounts } = buildAssignments(eligibleRows);
  const plannedRows = eligibleRows.map((row) => ({
    ...row,
    skt: assignments.get(row.id)?.newSkt || row.oldSkt,
    targetBucket: assignments.get(row.id)?.targetBucket || '',
  }));
  const fefoDerived = deriveFefoByProduct(plannedRows);
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    for (const row of plannedRows) {
      await tx.stockBatch.update({
        where: { id: row.id },
        data: { skt: row.skt },
      });
    }

    for (const [productId, fefo] of fefoDerived.entries()) {
      await tx.stock.update({
        where: { productId },
        data: {
          nearestExpiry: fefo.nearestExpiry,
          fefoDefaultExpiry: fefo.fefoDefaultExpiry,
          fefoDefaultBatchNo: fefo.fefoDefaultBatchNo,
          updatedAt: now,
        },
      });
    }
  }, { timeout: 60_000 });

  const changedProductIds = [...new Set(eligibleRows.map((row) => row.productId))];
  const afterRowsRaw = await prisma.$queryRaw`
    SELECT
      b.id,
      b.tenant_id AS "tenantId",
      b.stock_id AS "stockId",
      b.product_id AS "productId",
      b.batch_no AS "batchNo",
      b.skt,
      b.total_quantity AS "batchTotalQuantity",
      s.nearest_expiry AS "stockNearestExpiry",
      s.fefo_default_expiry AS "stockFefoDefaultExpiry",
      s.fefo_default_batch_no AS "stockFefoDefaultBatchNo",
      p.name AS "productName",
      p.sku,
      p.barcode,
      c.name AS "categoryName",
      c.code AS "categoryCode"
    FROM stock_batches b
    JOIN stocks s ON s.id = b.stock_id
    JOIN products p ON p.id = b.product_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE b.product_id = ANY(${changedProductIds})
    ORDER BY p.sku ASC, b.skt ASC NULLS LAST, b.batch_no ASC, b.id ASC
  `;
  const afterRowsById = new Map(afterRowsRaw.map((row) => [row.id, {
    ...row,
    batchTotalQuantity: Number(row.batchTotalQuantity || 0),
  }]));
  const afterEligibleRows = eligibleRows.map((row) => ({
    ...row,
    skt: afterRowsById.get(row.id)?.skt || null,
    batchNo: afterRowsById.get(row.id)?.batchNo || row.batchNo,
  }));

  const afterDistribution = summarizeDistribution(afterEligibleRows, 'skt');
  const expiredAfter = afterEligibleRows.filter((row) => bucketForSkt(row.skt) === 'expired').length;
  const sameDayAfter = summarizeSameDayTies(afterEligibleRows);
  const fefoIssues = assertNoFefoInversion(eligibleRows, afterEligibleRows);
  const samples = selectSamples(eligibleRows, afterEligibleRows);

  const stockMismatchRows = await prisma.$queryRaw`
    WITH nearest AS (
      SELECT DISTINCT ON (b.product_id)
        b.product_id,
        b.skt,
        b.batch_no
      FROM stock_batches b
      WHERE b.product_id = ANY(${changedProductIds})
        AND COALESCE(b.total_quantity, 0) > 0
        AND NULLIF(TRIM(COALESCE(b.skt, '')), '') IS NOT NULL
      ORDER BY b.product_id, b.skt ASC, b.batch_no ASC, b.id ASC
    )
    SELECT
      s.product_id AS "productId",
      s.nearest_expiry AS "nearestExpiry",
      s.fefo_default_expiry AS "fefoDefaultExpiry",
      s.fefo_default_batch_no AS "fefoDefaultBatchNo",
      n.skt AS "expectedExpiry",
      n.batch_no AS "expectedBatchNo"
    FROM stocks s
    LEFT JOIN nearest n ON n.product_id = s.product_id
    WHERE s.product_id = ANY(${changedProductIds})
      AND (
        COALESCE(s.nearest_expiry, '') IS DISTINCT FROM COALESCE(n.skt, '')
        OR COALESCE(s.fefo_default_expiry, '') IS DISTINCT FROM COALESCE(n.skt, '')
        OR COALESCE(s.fefo_default_batch_no, '') IS DISTINCT FROM COALESCE(n.batch_no, '')
      )
  `;

  const allAfterNonRequired = await prisma.stockBatch.findMany({
    where: { id: { in: [...nonRequiredSnapshot.keys()] } },
    select: { id: true, skt: true },
  });
  const nonRequiredTouched = allAfterNonRequired.filter((row) => (row.skt || null) !== nonRequiredSnapshot.get(row.id)).length;
  const batchNoChanged = afterEligibleRows.filter((row) => batchNoSnapshot.get(row.id) !== row.batchNo).length;
  const updatedBatchCount = afterEligibleRows.filter((row) => row.oldSkt !== row.skt).length;

  const report = {
    referenceDate: TODAY,
    updatedFields: [
      'stock_batches.skt',
      'stocks.nearest_expiry',
      'stocks.fefo_default_expiry',
      'stocks.fefo_default_batch_no',
    ],
    targetUniverse: {
      policy: SKT_POLICIES.REQUIRED,
      listedActivePositiveStockPositiveBatch: true,
      batchCount: eligibleRows.length,
      productCount: new Set(eligibleRows.map((row) => row.productId)).size,
    },
    updatedBatchCount,
    targetCounts: desiredCounts,
    assignedNominalCounts: assignedCounts,
    beforeDistribution,
    afterDistribution,
    expiredRequired: { before: expiredBefore, after: expiredAfter },
    categorySummary: summarizeCategories(afterEligibleRows, 'skt'),
    sameDayTie: { before: sameDayBefore, after: sameDayAfter },
    samples,
    validation: {
      fefoInversionCount: fefoIssues.length,
      fefoIssues: fefoIssues.slice(0, 5),
      batchNoChanged,
      stockNearestExpiryMismatch: stockMismatchRows.filter((row) => String(row.nearestExpiry || '') !== String(row.expectedExpiry || '')).length,
      stockFefoDefaultExpiryMismatch: stockMismatchRows.filter((row) => String(row.fefoDefaultExpiry || '') !== String(row.expectedExpiry || '')).length,
      stockFefoDefaultBatchNoMismatch: stockMismatchRows.filter((row) => String(row.fefoDefaultBatchNo || '') !== String(row.expectedBatchNo || '')).length,
      nonRequiredTouched,
    },
  };

  const failed = report.validation.fefoInversionCount
    || report.validation.batchNoChanged
    || report.validation.stockNearestExpiryMismatch
    || report.validation.stockFefoDefaultExpiryMismatch
    || report.validation.stockFefoDefaultBatchNoMismatch
    || report.validation.nonRequiredTouched;

  console.log(JSON.stringify(report, null, 2));

  await prisma.$disconnect();
  if (failed) process.exit(2);
};

main().catch(async (error) => {
  console.error(error);
  try {
    const prisma = await getPrisma();
    await prisma.$disconnect();
  } catch {
    // ignore disconnect errors in failure path
  }
  process.exit(1);
});
