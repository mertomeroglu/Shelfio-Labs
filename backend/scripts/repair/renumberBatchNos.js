import 'dotenv/config';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { getPrisma, disconnectPrisma } from '../../src/providers/postgresProvider.js';
import {
  createPublicBatchNoFromLegacy,
  isLegacyGeneratedBatchNo,
  resolveLegacyBatchRoot,
} from '../../src/utils/batchNumber.js';

const LEGACY_TOKEN_PATTERN = /OPN-(?:\d{6}-F\d+|SHF-\d{2}-\d+)-\d{2}/g;
const SKIP_GENERIC_COLUMNS = new Set([
  'stock_batches.batch_no',
  'stock_batches.payload',
]);
const PRESERVE_JSON_KEYS = new Set(['legacyBatchNo', 'legacy_batch_no']);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const reportPath = path.resolve(__dirname, '../../../runtime-logs/batch-renumber-report.json');

const isObject = (value) => value && typeof value === 'object' && !Array.isArray(value);

const replaceMappedText = (value, batchMap) => {
  if (typeof value !== 'string') return value;
  return value.replace(LEGACY_TOKEN_PATTERN, (token) => batchMap.get(token) || token);
};

const replaceMappedDeep = (value, batchMap) => {
  if (typeof value === 'string') return replaceMappedText(value, batchMap);
  if (Array.isArray(value)) return value.map((item) => replaceMappedDeep(item, batchMap));
  if (!isObject(value)) return value;

  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    PRESERVE_JSON_KEYS.has(key) ? item : replaceMappedDeep(item, batchMap),
  ]));
};

const normalizeJson = (value) => JSON.stringify(value ?? null);

const tableColumnKey = (row) => `${row.table_name}.${row.column_name}`;

const listTextAndJsonColumns = async (prisma) => prisma.$queryRaw`
  SELECT table_name, column_name, data_type, udt_name
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND (data_type IN ('text', 'character varying') OR udt_name IN ('jsonb','json'))
  ORDER BY table_name, column_name
`;

const countLegacyHits = async (prisma, columns) => {
  const hits = [];
  for (const column of columns) {
    const table = column.table_name;
    const name = column.column_name;
    const isJson = column.udt_name === 'jsonb' || column.udt_name === 'json' || column.data_type === 'jsonb' || column.data_type === 'json';
    const sql = isJson
      ? `SELECT COUNT(*)::int AS count FROM "${table}" WHERE "${name}"::text LIKE '%OPN-%'`
      : `SELECT COUNT(*)::int AS count FROM "${table}" WHERE "${name}" LIKE '%OPN-%'`;
    const result = await prisma.$queryRawUnsafe(sql);
    const count = Number(result?.[0]?.count || 0);
    if (count > 0) hits.push({ table, column: name, type: column.data_type, count });
  }
  return hits;
};

const buildBatchMap = async (prisma) => {
  const rows = await prisma.stockBatch.findMany({
    orderBy: [{ productId: 'asc' }, { batchNo: 'asc' }, { skt: 'asc' }],
    include: {
      stock: {
        include: {
          product: {
            select: { id: true, sku: true, brand: true, name: true },
          },
        },
      },
    },
  });

  const usedNewBatchNos = new Set();
  const batchMap = new Map();
  const rowsNeedingGeneration = [];
  const rootGroups = new Map();

  for (const row of rows) {
    const payload = isObject(row.payload) ? row.payload : {};
    const legacyBatchNo = isLegacyGeneratedBatchNo(payload.legacyBatchNo)
      ? String(payload.legacyBatchNo).trim()
      : isLegacyGeneratedBatchNo(row.batchNo)
        ? String(row.batchNo).trim()
        : '';

    if (!legacyBatchNo) {
      usedNewBatchNos.add(row.batchNo);
      continue;
    }

    if (!isLegacyGeneratedBatchNo(row.batchNo)) {
      batchMap.set(legacyBatchNo, row.batchNo);
      usedNewBatchNos.add(row.batchNo);
      continue;
    }

    const entry = { ...row, legacyBatchNo };
    rowsNeedingGeneration.push(entry);
    const root = resolveLegacyBatchRoot(legacyBatchNo);
    const current = rootGroups.get(root) || [];
    current.push(entry);
    rootGroups.set(root, current);
  }

  for (const [root, group] of [...rootGroups.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    let salt = 0;
    let candidates = [];

    while (salt < 1000) {
      candidates = group.map((row) => {
        const product = row.stock?.product || {};
        const newBatchNo = createPublicBatchNoFromLegacy({
          legacyBatchNo: row.legacyBatchNo,
          brand: product.brand,
          productName: product.name,
          productId: row.productId,
          salt,
        });
        return { row, newBatchNo };
      });

      if (candidates.every(({ newBatchNo }) => !usedNewBatchNos.has(newBatchNo))) break;
      salt += 1;
    }

    if (salt >= 1000) {
      throw new Error(`Unique public batch number could not be generated for root ${root}`);
    }

    for (const { row, newBatchNo } of candidates) {
      batchMap.set(row.legacyBatchNo, newBatchNo);
      usedNewBatchNos.add(newBatchNo);
    }
  }

  return {
    batchMap,
    rows,
    rowsNeedingGeneration,
  };
};

const updateGenericColumn = async ({ tx, table, column, isJson, batchMap }) => {
  const predicate = isJson ? `"${column}"::text LIKE '%OPN-%'` : `"${column}" LIKE '%OPN-%'`;
  const rows = await tx.$queryRawUnsafe(`SELECT id, "${column}" AS value FROM "${table}" WHERE ${predicate}`);
  let updated = 0;

  for (const row of rows) {
    const current = row.value;
    const next = isJson ? replaceMappedDeep(current, batchMap) : replaceMappedText(current, batchMap);
    const changed = isJson ? normalizeJson(current) !== normalizeJson(next) : current !== next;
    if (!changed) continue;

    if (isJson) {
      await tx.$executeRawUnsafe(
        `UPDATE "${table}" SET "${column}" = $1::jsonb WHERE id = $2`,
        JSON.stringify(next ?? null),
        row.id
      );
    } else {
      await tx.$executeRawUnsafe(
        `UPDATE "${table}" SET "${column}" = $1 WHERE id = $2`,
        next,
        row.id
      );
    }
    updated += 1;
  }

  return updated;
};

const updateStockBatches = async ({ tx, rows, batchMap }) => {
  let updated = 0;
  const examples = [];

  for (const row of rows) {
    const payload = isObject(row.payload) ? row.payload : {};
    const legacyBatchNo = isLegacyGeneratedBatchNo(payload.legacyBatchNo)
      ? String(payload.legacyBatchNo).trim()
      : isLegacyGeneratedBatchNo(row.batchNo)
        ? String(row.batchNo).trim()
        : '';
    const newBatchNo = batchMap.get(legacyBatchNo);

    if (!legacyBatchNo || !newBatchNo) continue;

    const nextPayload = {
      ...replaceMappedDeep(payload, batchMap),
      legacyBatchNo,
      publicBatchNo: newBatchNo,
      batchNo: newBatchNo,
      batchNoFormat: 'brand-public-v1',
    };

    const shouldUpdate = row.batchNo !== newBatchNo || normalizeJson(payload) !== normalizeJson(nextPayload);
    if (!shouldUpdate) continue;

    await tx.stockBatch.update({
      where: { id: row.id },
      data: {
        batchNo: newBatchNo,
        payload: nextPayload,
      },
    });

    if (examples.length < 15) {
      examples.push({
        old: legacyBatchNo,
        new: newBatchNo,
        brand: row.stock?.product?.brand || '',
        productName: row.stock?.product?.name || '',
        skt: row.skt || null,
      });
    }
    updated += 1;
  }

  return { updated, examples };
};

const verifyRelations = async (prisma) => {
  const [
    totalBatches,
    duplicateNew,
    orphanFefo,
    orphanLocations,
    oldStyleTaskCount,
    oldStyleStockMovementCount,
    oldStyleWarehouseMovementCount,
    oldStyleWarehouseLocationCount,
    oldStyleFefoCount,
  ] = await Promise.all([
    prisma.stockBatch.count(),
    prisma.$queryRaw`
      SELECT batch_no AS "batchNo", COUNT(*)::int AS count
      FROM stock_batches
      GROUP BY batch_no
      HAVING COUNT(*) > 1
      ORDER BY COUNT(*) DESC
      LIMIT 20
    `,
    prisma.$queryRaw`
      SELECT COUNT(*)::int AS count
      FROM stocks s
      WHERE NULLIF(TRIM(s.fefo_default_batch_no), '') IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM stock_batches b
          WHERE b.stock_id = s.id AND b.batch_no = s.fefo_default_batch_no
        )
    `,
    prisma.$queryRaw`
      SELECT COUNT(*)::int AS count
      FROM warehouse_locations wl
      WHERE NULLIF(TRIM(wl.batch_no), '') IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM stock_batches b
          WHERE b.product_id = wl.product_id AND b.batch_no = wl.batch_no
        )
    `,
    prisma.task.count({ where: { OR: [{ description: { contains: 'OPN-' } }, { title: { contains: 'OPN-' } }] } }),
    prisma.stockMovement.count({ where: { batchNo: { startsWith: 'OPN-' } } }),
    prisma.warehouseMovement.count({ where: { batchNo: { startsWith: 'OPN-' } } }),
    prisma.warehouseLocation.count({ where: { batchNo: { startsWith: 'OPN-' } } }),
    prisma.stock.count({ where: { fefoDefaultBatchNo: { startsWith: 'OPN-' } } }),
  ]);

  const distinctBatchNos = await prisma.$queryRaw`SELECT COUNT(DISTINCT batch_no)::int AS count FROM stock_batches`;

  return {
    totalBatches: Number(totalBatches || 0),
    distinctBatchNos: Number(distinctBatchNos?.[0]?.count || 0),
    duplicateBatchNos: duplicateNew,
    orphanFefoDefaults: Number(orphanFefo?.[0]?.count || 0),
    orphanWarehouseLocations: Number(orphanLocations?.[0]?.count || 0),
    oldStyleTaskCount,
    oldStyleStockMovementCount,
    oldStyleWarehouseMovementCount,
    oldStyleWarehouseLocationCount,
    oldStyleFefoCount,
  };
};

const main = async () => {
  const prisma = await getPrisma();
  const columns = await listTextAndJsonColumns(prisma);
  const beforeHits = await countLegacyHits(prisma, columns);
  const { batchMap, rows } = await buildBatchMap(prisma);

  if (batchMap.size === 0) {
    const report = {
      changed: false,
      reason: 'No legacy generated OPN batch numbers found.',
      beforeHits,
      verification: await verifyRelations(prisma),
    };
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const updateSummary = await prisma.$transaction(async (tx) => {
    const genericUpdates = [];

    for (const column of columns) {
      const key = tableColumnKey(column);
      if (SKIP_GENERIC_COLUMNS.has(key)) continue;

      const isJson = column.udt_name === 'jsonb' || column.udt_name === 'json' || column.data_type === 'jsonb' || column.data_type === 'json';
      const updated = await updateGenericColumn({
        tx,
        table: column.table_name,
        column: column.column_name,
        isJson,
        batchMap,
      });

      if (updated > 0) {
        genericUpdates.push({
          table: column.table_name,
          column: column.column_name,
          updated,
        });
      }
    }

    const stockBatchUpdate = await updateStockBatches({ tx, rows, batchMap });
    return {
      genericUpdates,
      stockBatchUpdate,
    };
  }, { maxWait: 30000, timeout: 600000 });

  const afterHits = await countLegacyHits(prisma, columns);
  const verification = await verifyRelations(prisma);
  const report = {
    changed: true,
    format: 'BRANDPREFIX-ALPHANUM6-NN',
    mapSize: batchMap.size,
    beforeHits,
    afterHits,
    updatedStockBatchRows: updateSummary.stockBatchUpdate.updated,
    updatedColumns: updateSummary.genericUpdates,
    examples: updateSummary.stockBatchUpdate.examples,
    verification,
  };

  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report, null, 2));
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectPrisma();
  });
