import { getPrisma } from '../../src/providers/postgresProvider.js';

async function main() {
  console.log('[normalizeMoq] Initializing Prisma...');
  let prisma;
  try {
    prisma = await getPrisma();
  } catch (err) {
    console.error('[normalizeMoq] Failed to initialize Prisma Client:', err.message);
    process.exit(1);
  }

  try {
    // 1. Normalize SupplierProduct MOQ values
    console.log('[normalizeMoq] Fetching SupplierProduct records...');
    const supplierProducts = await prisma.supplierProduct.findMany({
      select: {
        id: true,
        minimumOrderQty: true,
        minOrderQty: true,
        minOrderUnit: true,
        defaultOrderUnit: true,
      }
    });
    console.log(`[normalizeMoq] Found ${supplierProducts.length} SupplierProduct records.`);

    let spUpdated = 0;
    for (const sp of supplierProducts) {
      let needsUpdate = false;
      const data = {};

      const currentMoq = sp.minimumOrderQty !== null ? Number(sp.minimumOrderQty) : null;
      if (currentMoq !== null && currentMoq > 2) {
        data.minimumOrderQty = (currentMoq % 2 === 0) ? 2 : 1;
        needsUpdate = true;
      }

      const currentMinOrderQty = sp.minOrderQty !== null ? Number(sp.minOrderQty) : null;
      if (currentMinOrderQty !== null && currentMinOrderQty > 2) {
        data.minOrderQty = (currentMinOrderQty % 2 === 0) ? 2 : 1;
        needsUpdate = true;
      }

      if (sp.minOrderUnit !== 'koli') {
        data.minOrderUnit = 'koli';
        needsUpdate = true;
      }

      if (sp.defaultOrderUnit !== 'koli') {
        data.defaultOrderUnit = 'koli';
        needsUpdate = true;
      }

      if (needsUpdate) {
        await prisma.supplierProduct.update({
          where: { id: sp.id },
          data,
        });
        spUpdated++;
      }
    }
    console.log(`[normalizeMoq] Updated ${spUpdated} SupplierProduct records.`);

    // 2. Normalize Product MOQ values
    console.log('[normalizeMoq] Fetching Product records...');
    const products = await prisma.product.findMany({
      select: {
        id: true,
        minimumOrderCaseQty: true,
      }
    });
    console.log(`[normalizeMoq] Found ${products.length} Product records.`);

    let pUpdated = 0;
    for (const p of products) {
      const currentMoq = p.minimumOrderCaseQty !== null ? Number(p.minimumOrderCaseQty) : null;
      if (currentMoq !== null && currentMoq > 2) {
        const nextMoq = (currentMoq % 2 === 0) ? 2 : 1;
        await prisma.product.update({
          where: { id: p.id },
          data: { minimumOrderCaseQty: nextMoq },
        });
        pUpdated++;
      }
    }
    console.log(`[normalizeMoq] Updated ${pUpdated} Product records.`);
    console.log('[normalizeMoq] Normalization completed successfully.');

  } catch (error) {
    console.error('[normalizeMoq] Error during normalization:', error);
  } finally {
    if (prisma) {
      await prisma.$disconnect();
    }
  }
}

main().catch(err => {
  console.error('[normalizeMoq] Fatal error:', err);
  process.exit(1);
});
