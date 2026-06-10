import 'dotenv/config';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { getPrisma, disconnectPrisma } from '../src/providers/postgresProvider.js';
import { runWithTenantContext } from '../src/tenant/tenantContext.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const reportPath = path.resolve(__dirname, '../../runtime-logs/location-cleanup-report.json');

const args = process.argv.slice(2);
const isApply = args.includes('--apply');
const isConfirm = args.includes('--confirm');

const run = async () => {
  const prisma = await getPrisma();

  // Load all tenants
  const tenants = await prisma.tenant.findMany({
    where: { status: 'active' }
  });

  const overallReport = {
    executedAt: new Date().toISOString(),
    isApply,
    isConfirm,
    tenants: {}
  };

  let totalProductsUpdated = 0;
  let totalWarehouseLocationsCleaned = 0;

  for (const tenant of tenants) {
    // Run within tenant context so that prisma middleware filters by tenantId
    await runWithTenantContext({ tenantId: tenant.id }, async () => {
      // 1. Fetch all required entities for this tenant
      const sections = await prisma.section.findMany();
      const warehouseLocations = await prisma.warehouseLocation.findMany();
      const products = await prisma.product.findMany({
        include: { stock: true }
      });

      const sectionMap = new Map(sections.map(s => [s.id, s]));
      const whLocMap = new Map(warehouseLocations.map(l => [l.locationCode, l]));

      // 2. Perform Stats Analysis
      const totalProducts = products.length;
      const activeProducts = products.filter(p => p.isActive !== false).length;
      const listedProducts = products.filter(p => p.isListed !== false).length;
      const virtualProducts = products.filter(p => p.isVirtualLocation === true).length;
      
      const virtualWithSection = products.filter(p => p.isVirtualLocation === true && p.sectionId !== null).length;
      const virtualWithShelfDetails = products.filter(p => 
        p.isVirtualLocation === true && 
        p.sectionId !== null && 
        (p.shelfSide !== null || p.shelfNo !== null || p.shelfLevel !== null)
      );

      const virtualWithDepot = products.filter(p => 
        p.isVirtualLocation === true && 
        p.depotLocationCode !== null && 
        p.depotLocationCode !== ''
      );

      const virtualDepotStockNoCode = products.filter(p => 
        p.isVirtualLocation === true && 
        (p.depotLocationCode === null || p.depotLocationCode === '') && 
        p.stock?.warehouseQuantity > 0
      ).length;

      // Conflicts calculation
      // Coordinate key: sectionId-shelfSide-shelfNo-shelfLevel
      const getSlotKey = (p) => {
        if (!p.sectionId || !p.shelfSide || p.shelfNo === null || p.shelfLevel === null) return null;
        return `${p.sectionId}-${String(p.shelfSide).toUpperCase()}-${p.shelfNo}-${p.shelfLevel}`;
      };

      const slotGroupsBefore = {};
      const slotGroupsAfter = {}; // only physical products

      for (const p of products) {
        const key = getSlotKey(p);
        if (key) {
          if (!slotGroupsBefore[key]) slotGroupsBefore[key] = [];
          slotGroupsBefore[key].push(p);

          // If it is physical (not cleaned up), it stays in slotGroupsAfter
          if (p.isVirtualLocation !== true) {
            if (!slotGroupsAfter[key]) slotGroupsAfter[key] = [];
            slotGroupsAfter[key].push(p);
          }
        }
      }

      let totalConflictsBefore = 0;
      let totalConflictedProductsBefore = 0;
      const conflictsBeforeDetails = [];

      for (const [key, group] of Object.entries(slotGroupsBefore)) {
        if (group.length > 1) {
          totalConflictsBefore++;
          totalConflictedProductsBefore += group.length;
          conflictsBeforeDetails.push({
            slotKey: key,
            products: group.map(g => ({ id: g.id, name: g.name, sku: g.sku, isVirtualLocation: g.isVirtualLocation }))
          });
        }
      }

      let totalConflictsAfter = 0;
      let totalConflictedProductsAfter = 0;

      for (const [key, group] of Object.entries(slotGroupsAfter)) {
        if (group.length > 1) {
          totalConflictsAfter++;
          totalConflictedProductsAfter += group.length;
        }
      }

      // Products completely locationless
      const completelyLocationless = products.filter(p => p.sectionId === null && p.depotLocationCode === null).length;
      const activeListedNoSection = products.filter(p => p.isActive !== false && p.isListed !== false && p.sectionId === null).length;

      // Orphans / Mismatches
      const orphanSections = [];
      const mismatchedDepotLocations = [];

      for (const p of products) {
        if (p.sectionId && !sectionMap.has(p.sectionId)) {
          orphanSections.push({ id: p.id, name: p.name, sku: p.sku, sectionId: p.sectionId });
        }
        if (p.depotLocationCode && !whLocMap.has(p.depotLocationCode)) {
          mismatchedDepotLocations.push({ id: p.id, name: p.name, sku: p.sku, depotLocationCode: p.depotLocationCode });
        }
      }

      // 3. Examples Gathering (top 20)
      const commonAisleExamples = products
        .filter(p => p.isVirtualLocation === true && p.sectionId !== null && (p.shelfSide !== null || p.shelfNo !== null || p.shelfLevel !== null))
        .slice(0, 20)
        .map(p => ({
          id: p.id,
          name: p.name,
          sku: p.sku,
          isVirtualLocation: p.isVirtualLocation,
          sectionId: p.sectionId,
          shelfSide: p.shelfSide,
          shelfNo: p.shelfNo,
          shelfLevel: p.shelfLevel,
          shelfCode: p.shelfCode,
          warehouseQuantity: p.stock?.warehouseQuantity || 0,
          shelfQuantity: p.stock?.shelfQuantity || 0,
          expectedStateAfter: {
            sectionId: p.sectionId,
            shelfSide: null,
            shelfNo: null,
            shelfLevel: null,
            shelfCode: null,
            isVirtualLocation: true
          }
        }));

      const commonDepotExamples = products
        .filter(p => p.isVirtualLocation === true && p.depotLocationCode !== null && p.depotLocationCode !== '')
        .slice(0, 20)
        .map(p => {
          const loc = whLocMap.get(p.depotLocationCode);
          const hasPhysicalStock = loc ? (loc.warehouseStock > 0 || (loc.palletCount || 0) > 0 || Number(loc.occupancy || 0) > 0) : false;
          return {
            id: p.id,
            name: p.name,
            sku: p.sku,
            isVirtualLocation: p.isVirtualLocation,
            depotLocationCode: p.depotLocationCode,
            warehouseQuantity: p.stock?.warehouseQuantity || 0,
            hasPhysicalStockInLocation: hasPhysicalStock,
            locationStockDetails: loc ? { stock: loc.warehouseStock, palletCount: loc.palletCount, occupancy: loc.occupancy } : null,
            expectedStateAfter: {
              depotLocationCode: null,
              defaultWarehouseLocationCode: null,
              depotAssignmentType: 'shared_overflow',
              capacityMode: 'unbounded_virtual',
              isVirtualLocation: true,
              warehouseLocationRecordCleared: !hasPhysicalStock
            }
          };
        });

      const conflictsExamples = conflictsBeforeDetails.slice(0, 20);

      const stillProblematicExamples = products
        .filter(p => p.isVirtualLocation !== true && (!p.sectionId || p.shelfSide === null || p.shelfNo === null || p.shelfLevel === null))
        .slice(0, 20)
        .map(p => ({
          id: p.id,
          name: p.name,
          sku: p.sku,
          isVirtualLocation: p.isVirtualLocation,
          sectionId: p.sectionId,
          shelfSide: p.shelfSide,
          shelfNo: p.shelfNo,
          shelfLevel: p.shelfLevel,
          reason: 'Fiziksel ürün olmasına rağmen reyon koordinatları eksik'
        }));

      const activeListedNoSectionExamples = products
        .filter(p => p.isActive !== false && p.isListed !== false && p.sectionId === null)
        .slice(0, 20)
        .map(p => ({
          id: p.id,
          name: p.name,
          sku: p.sku,
          isActive: p.isActive,
          isListed: p.isListed
        }));

      const mismatchedDepotExamples = mismatchedDepotLocations.slice(0, 20);

      const incompleteShelfCoordsExamples = products
        .filter(p => p.isVirtualLocation !== true && p.sectionId && (p.shelfSide === null || p.shelfNo === null || p.shelfLevel === null))
        .slice(0, 20)
        .map(p => ({
          id: p.id,
          name: p.name,
          sku: p.sku,
          sectionId: p.sectionId,
          shelfSide: p.shelfSide,
          shelfNo: p.shelfNo,
          shelfLevel: p.shelfLevel
        }));

      // Cleanup post-stats estimate
      const estimatedPhysicalReyonProductsAfter = products.filter(p => 
        p.isVirtualLocation !== true && 
        p.sectionId !== null && 
        p.shelfSide !== null && 
        p.shelfNo !== null && 
        p.shelfLevel !== null
      ).length;

      const estimatedPhysicalDoluGozAfter = Object.keys(slotGroupsAfter).length;

      // 4. Cleanup Execution in Transaction if mode is APPLY and CONFIRMED
      let tenantUpdatedProducts = 0;
      let tenantCleanedWarehouseLocations = 0;
      const skippedWarehouseLocationsWithStock = [];

      if (isApply && isConfirm) {
        await prisma.$transaction(async (tx) => {
          // Process Common Aisle Cleanup
          for (const item of commonAisleExamples) {
            // Fetch fresh product info to make sure
            const p = await tx.product.findUnique({ where: { id: item.id } });
            if (p) {
              const payloadBackup = p.payload && typeof p.payload === 'object' ? { ...p.payload } : {};
              payloadBackup.legacyLocationBackup = {
                sectionId: p.sectionId,
                shelfSide: p.shelfSide,
                shelfNo: p.shelfNo,
                shelfLevel: p.shelfLevel,
                shelfCode: p.shelfCode,
                depotLocationCode: p.depotLocationCode,
                defaultWarehouseLocationCode: p.defaultWarehouseLocationCode,
                backedUpAt: new Date().toISOString()
              };

              await tx.product.update({
                where: { id: p.id },
                data: {
                  shelfSide: null,
                  shelfNo: null,
                  shelfLevel: null,
                  shelfCode: null,
                  payload: payloadBackup
                }
              });
              tenantUpdatedProducts++;
            }
          }

          // Process Common Depot Cleanup
          for (const item of commonDepotExamples) {
            const p = await tx.product.findUnique({ where: { id: item.id } });
            if (p) {
              const payloadBackup = p.payload && typeof p.payload === 'object' ? { ...p.payload } : {};
              payloadBackup.legacyLocationBackup = {
                sectionId: p.sectionId,
                shelfSide: p.shelfSide,
                shelfNo: p.shelfNo,
                shelfLevel: p.shelfLevel,
                shelfCode: p.shelfCode,
                depotLocationCode: p.depotLocationCode,
                defaultWarehouseLocationCode: p.defaultWarehouseLocationCode,
                backedUpAt: new Date().toISOString()
              };

              // Clear matching warehouse location if exists and has no stock
              if (p.depotLocationCode) {
                const loc = await tx.warehouseLocation.findFirst({
                  where: { locationCode: p.depotLocationCode }
                });
                if (loc) {
                  const hasPhysicalStock = loc.warehouseStock > 0 || (loc.palletCount || 0) > 0 || Number(loc.occupancy || 0) > 0;
                  if (!hasPhysicalStock) {
                    await tx.warehouseLocation.update({
                      where: { id: loc.id },
                      data: {
                        productId: null,
                        productName: null,
                        sku: null,
                        barcode: null,
                        status: 'Boş'
                      }
                    });
                    tenantCleanedWarehouseLocations++;
                  } else {
                    skippedWarehouseLocationsWithStock.push({
                      locationCode: loc.locationCode,
                      productId: p.id,
                      stock: loc.warehouseStock,
                      palletCount: loc.palletCount,
                      occupancy: loc.occupancy
                    });
                  }
                }
              }

              await tx.product.update({
                where: { id: p.id },
                data: {
                  depotLocationCode: null,
                  defaultWarehouseLocationCode: null,
                  depotAssignmentType: 'shared_overflow',
                  capacityMode: 'unbounded_virtual',
                  payload: payloadBackup
                }
              });
              tenantUpdatedProducts++;
            }
          }
        });

        totalProductsUpdated += tenantUpdatedProducts;
        totalWarehouseLocationsCleaned += tenantCleanedWarehouseLocations;
      }

      tenant.report = {
        summary: {
          totalProducts,
          activeProducts,
          listedProducts,
          virtualProducts,
          virtualWithSection,
          virtualWithShelfDetails: virtualWithShelfDetails.length,
          virtualAisleCleanupCount: virtualWithShelfDetails.length,
          virtualWithDepot: virtualWithDepot.length,
          virtualDepotStockNoCode,
          virtualDepotCleanupCount: virtualWithDepot.length,
          totalConflictsBefore,
          totalConflictedProductsBefore,
          totalConflictsAfter,
          totalConflictedProductsAfter,
          completelyLocationless,
          activeListedNoSection,
          orphanSectionCount: orphanSections.length,
          mismatchedDepotLocationCount: mismatchedDepotLocations.length,
          estimatedPhysicalReyonProductsAfter,
          estimatedPhysicalDoluGozAfter
        },
        orphans: {
          orphanSections,
          mismatchedDepotLocations
        },
        examples: {
          commonAisleExamples,
          commonDepotExamples,
          conflictsExamples,
          stillProblematicExamples,
          activeListedNoSectionExamples,
          mismatchedDepotExamples,
          incompleteShelfCoordsExamples
        },
        execution: isApply && isConfirm ? {
          updatedProductsCount: tenantUpdatedProducts,
          cleanedWarehouseLocationsCount: tenantCleanedWarehouseLocations,
          skippedWarehouseLocationsWithStock
        } : null
      };

      overallReport.tenants[tenant.slug] = tenant.report;
    });
  }

  overallReport.totals = {
    totalProductsUpdated,
    totalWarehouseLocationsCleaned
  };

  // Write report to runtime logs
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(overallReport, null, 2), 'utf8');

  // Print results
  console.log(JSON.stringify({
    ok: true,
    message: isApply && isConfirm ? 'Cleanup completed successfully.' : 'Dry-run report generated successfully.',
    reportFile: reportPath,
    totals: overallReport.totals,
    tenantsSummary: Object.fromEntries(
      Object.entries(overallReport.tenants).map(([slug, r]) => [slug, r.summary])
    )
  }, null, 2));
};

run()
  .catch((error) => {
    console.error('Cleanup/Dry-run process failed:', error?.message || String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectPrisma();
  });
