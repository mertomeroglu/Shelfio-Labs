import { getPrisma } from '../../src/providers/postgresProvider.js';
import {
  buildRetailCaseStockPlan,
  buildTwoCaseSkuSet,
  isActiveRetailProduct,
} from '../../src/utils/retailStockPolicy.js';

const now = new Date();

const activeBatchCount = (batches = []) =>
  batches.filter((batch) => Number(batch?.totalQuantity || 0) > 0).length;

const normalizeBatchesToPlan = ({ product, stock = {}, plan }) => {
  const source = Array.isArray(stock?.batches) && stock.batches.length > 0
    ? stock.batches
    : [{
      id: null,
      stockId: stock?.id || null,
      productId: product.id,
      batchNo: stock?.fefoDefaultBatchNo || `OPN-${product.sku}-01`,
      skt: stock?.fefoDefaultExpiry || stock?.nearestExpiry || '',
    }];

  if (!isActiveRetailProduct(product)) {
    return source.map((batch) => ({
      ...batch,
      warehouseQuantity: 0,
      shelfQuantity: 0,
      totalQuantity: 0,
      status: 'Tukendi',
    }));
  }

  let remainingWarehouse = plan.warehouseQuantity;
  return source.map((batch, index) => {
    const isLast = index === source.length - 1;
    const shelfQuantity = index === 0 ? plan.shelfQuantity : 0;
    const warehouseQuantity = isLast
      ? remainingWarehouse
      : Math.floor(plan.warehouseQuantity / source.length);
    remainingWarehouse -= warehouseQuantity;
    const totalQuantity = shelfQuantity + warehouseQuantity;
    return {
      ...batch,
      warehouseQuantity,
      shelfQuantity,
      totalQuantity,
      status: totalQuantity > 0 ? 'Aktif' : 'Tukendi',
    };
  });
};

const main = async () => {
  const prisma = await getPrisma();
  const products = await prisma.product.findMany({
    include: {
      stock: {
        include: {
          batches: {
            orderBy: [{ skt: 'asc' }, { batchNo: 'asc' }],
          },
        },
      },
    },
    orderBy: [{ sku: 'asc' }],
  });

  const before = {
    totalProducts: products.length,
    listedActiveProducts: products.filter(isActiveRetailProduct).length,
    unlistedProducts: products.filter((product) => product.isListed === false).length,
    catalogOnlyProducts: products.filter((product) => String(product.catalogVisibility || '').toLowerCase() === 'catalog_only').length,
    productRowsWithShelfAssignment: products.filter((product) => product.sectionId && product.shelfCode).length,
  };

  const twoCaseSkuSet = buildTwoCaseSkuSet(products);
  const samples = [];
  let clearedUnlistedShelfAssignments = 0;
  let clearedUnlistedDepotAssignments = 0;

  for (const product of products) {
    const stock = product.stock || null;
    const plan = buildRetailCaseStockPlan(product, twoCaseSkuSet);
    const active = isActiveRetailProduct(product);
    const oldSnapshot = samples.length < 10 && active
      ? {
        sku: product.sku,
        name: product.name,
        unitsPerCase: plan.unitsPerCase,
        shelfCases: plan.shelfCaseCount,
        oldShelfStock: Number(stock?.shelfQuantity || 0),
        oldDepotStock: Number(stock?.warehouseQuantity || 0),
        oldCapacity: Number(product.maxShelfStock || 0),
        oldCriticalStock: Number(product.criticalStock || 0),
      }
      : null;

    if (!active) {
      if (product.sectionId || product.shelfCode || product.shelfNo || product.shelfLevel || product.shelfSide) {
        clearedUnlistedShelfAssignments += 1;
      }
      if (product.depotLocationCode || product.defaultWarehouseLocationCode || product.depotAssignmentType !== 'no_physical_assignment') {
        clearedUnlistedDepotAssignments += 1;
      }
    }

    const productData = active
      ? {
        criticalStock: plan.criticalStock,
        maxShelfStock: plan.shelfCapacity,
        maxStock: plan.maxStock,
        payload: {
          ...(product.payload && typeof product.payload === 'object' ? product.payload : {}),
          retailCaseStockPolicy: {
            shelfCaseCount: plan.shelfCaseCount,
            supportCaseCount: plan.supportCaseCount,
            unitsPerCase: plan.unitsPerCase,
          },
        },
        updatedAt: now,
      }
      : {
        sectionId: null,
        shelfSide: null,
        shelfNo: null,
        shelfLevel: null,
        shelfCode: null,
        criticalStock: 0,
        maxShelfStock: 0,
        maxStock: 0,
        depotAssignmentType: 'no_physical_assignment',
        depotLocationCode: null,
        depotZoneCode: null,
        isVirtualLocation: true,
        capacityMode: 'no_capacity',
        stockingStrategy: 'no_active_stock',
        assignmentPriority: 100,
        depotLocationLabel: 'Fiziksel atama yok',
        defaultWarehouseLocationCode: null,
        alternativeWarehouseLocationCodes: [],
        updatedAt: now,
      };

    await prisma.product.update({
      where: { id: product.id },
      data: productData,
    });

    const batches = normalizeBatchesToPlan({ product, stock, plan });
    const nearest = [...batches]
      .filter((batch) => Number(batch.totalQuantity || 0) > 0 && batch.skt)
      .sort((left, right) => String(left.skt).localeCompare(String(right.skt)))[0] || batches[0] || null;
    const quantity = plan.warehouseQuantity + plan.shelfQuantity;
    const stockRow = stock
      ? await prisma.stock.update({
        where: { productId: product.id },
        data: {
          warehouseQuantity: plan.warehouseQuantity,
          shelfQuantity: plan.shelfQuantity,
          quantity,
          onHand: quantity,
          available: Math.max(0, quantity - Number(stock.reserved || 0)),
          batchCount: activeBatchCount(batches),
          nearestExpiry: nearest?.skt || '',
          fefoDefaultBatchNo: nearest?.batchNo || '',
          fefoDefaultExpiry: nearest?.skt || '',
          updatedAt: now,
        },
      })
      : await prisma.stock.create({
        data: {
          productId: product.id,
          warehouseQuantity: plan.warehouseQuantity,
          shelfQuantity: plan.shelfQuantity,
          quantity,
          onHand: quantity,
          available: quantity,
          reserved: 0,
          batchCount: activeBatchCount(batches),
          nearestExpiry: nearest?.skt || '',
          fefoDefaultBatchNo: nearest?.batchNo || '',
          fefoDefaultExpiry: nearest?.skt || '',
          updatedAt: now,
        },
      });

    for (const [index, batch] of batches.entries()) {
      const data = {
        stockId: stockRow.id,
        productId: product.id,
        batchNo: batch.batchNo || `OPN-${product.sku}-${String(index + 1).padStart(2, '0')}`,
        skt: batch.skt || '',
        warehouseQuantity: batch.warehouseQuantity,
        shelfQuantity: batch.shelfQuantity,
        totalQuantity: batch.totalQuantity,
        status: batch.status,
        payload: batch.payload || {},
      };
      if (batch.id) {
        await prisma.stockBatch.update({ where: { id: batch.id }, data });
      } else {
        await prisma.stockBatch.create({ data });
      }
    }

    if (active) {
      await prisma.$executeRaw`
        UPDATE warehouse_locations
        SET product_name = ${product.name},
            sku = ${product.sku},
            barcode = ${product.barcode || null},
            warehouse_stock = ${plan.warehouseQuantity},
            updated_at = ${now}
        WHERE product_id = ${product.id}
      `;
    } else {
      await prisma.$executeRaw`
        UPDATE warehouse_locations
        SET product_id = NULL,
            product_name = NULL,
            sku = NULL,
            barcode = NULL,
            supplier_id = NULL,
            supplier_name = NULL,
            pallet_count = 0,
            occupancy = 0,
            warehouse_stock = 0,
            updated_at = ${now}
        WHERE product_id = ${product.id}
      `;
    }

    await prisma.purchaseSuggestion.updateMany({
      where: { productId: product.id },
      data: {
        currentStock: quantity,
        criticalStock: active ? plan.criticalStock : 0,
        updatedAt: now,
      },
    });

    if (oldSnapshot) {
      samples.push({
        ...oldSnapshot,
        newShelfStock: plan.shelfQuantity,
        newDepotStock: plan.warehouseQuantity,
        newCapacity: plan.shelfCapacity,
        newCriticalStock: plan.criticalStock,
        stockStatus: plan.shelfQuantity <= plan.criticalStock ? 'critical' : 'normal',
      });
    }
  }

  await prisma.purchaseSuggestion.deleteMany({
    where: {
      product: {
        OR: [
          { isListed: false },
          { catalogVisibility: 'catalog_only' },
        ],
      },
    },
  });

  const repaired = await prisma.product.findMany({
    select: {
      id: true,
      sku: true,
      isListed: true,
      isActive: true,
      catalogVisibility: true,
      registerOnOrder: true,
      sectionId: true,
      shelfCode: true,
      unitsPerCase: true,
      stock: { select: { warehouseQuantity: true, shelfQuantity: true } },
    },
  });

  const afterActive = repaired.filter(isActiveRetailProduct);
  const after = {
    totalProducts: repaired.length,
    listedActiveProducts: afterActive.length,
    unlistedProducts: repaired.filter((product) => product.isListed === false).length,
    catalogOnlyProducts: repaired.filter((product) => String(product.catalogVisibility || '').toLowerCase() === 'catalog_only').length,
    productRowsWithShelfAssignment: repaired.filter((product) => isActiveRetailProduct(product) && product.sectionId && product.shelfCode).length,
    oneCaseCount: afterActive.filter((product) => Number(product.stock?.shelfQuantity || 0) / Number(product.unitsPerCase || 1) === 1).length,
    twoCaseCount: afterActive.filter((product) => Number(product.stock?.shelfQuantity || 0) / Number(product.unitsPerCase || 1) === 2).length,
  };

  console.log(JSON.stringify({
    generatedAt: now.toISOString(),
    before,
    after,
    cleanup: {
      clearedUnlistedShelfAssignments,
      clearedUnlistedDepotAssignments,
    },
    samples,
  }, null, 2));

  await prisma.$disconnect();
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
