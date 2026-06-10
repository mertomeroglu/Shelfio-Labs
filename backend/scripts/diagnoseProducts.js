/**
 * diagnoseProducts.js - run from backend directory with: node scripts/diagnoseProducts.js
 */
import { getPrisma } from '../src/providers/postgresProvider.js';

async function main() {
  const prisma = await getPrisma();
  try {
    // 1. Count total products
    const total = await prisma.product.count();
    console.log(`\n=== TOTAL PRODUCTS: ${total} ===\n`);

    // 2. Count products with valid shelf coordinates
    const withShelf = await prisma.product.count({
      where: {
        sectionId: { not: null },
        shelfSide: { not: null },
        shelfNo: { not: null },
        shelfLevel: { not: null },
      }
    });
    console.log(`Products with full shelf coords (sectionId + shelfSide + shelfNo + shelfLevel): ${withShelf}`);

    // 3. Sample 5 products with shelf coords
    const samples = await prisma.product.findMany({
      where: {
        sectionId: { not: null },
        shelfSide: { not: null },
        shelfNo: { not: null },
        shelfLevel: { not: null },
      },
      select: {
        id: true,
        name: true,
        sectionId: true,
        shelfSide: true,
        shelfNo: true,
        shelfLevel: true,
        isActive: true,
        isListed: true,
      },
      take: 5,
    });

    console.log('\n=== SAMPLE PRODUCTS WITH SHELF COORDS ===');
    samples.forEach(p => {
      console.log({
        name: p.name?.slice(0, 30),
        sectionId: p.sectionId?.slice(0, 8) + '...',
        shelfSide: `type=${typeof p.shelfSide}, val="${p.shelfSide}"`,
        shelfNo: `type=${typeof p.shelfNo}, val=${p.shelfNo}`,
        shelfLevel: `type=${typeof p.shelfLevel}, val=${p.shelfLevel}`,
        key: `${p.sectionId}-${String(p.shelfSide).toUpperCase()}-${p.shelfNo}-${p.shelfLevel}`,
        isActive: p.isActive,
        isListed: p.isListed,
      });
    });

    // 4. Shelf range check
    const shelfNoRange = await prisma.product.aggregate({
      where: { shelfNo: { not: null } },
      _min: { shelfNo: true },
      _max: { shelfNo: true },
    });
    const shelfLevelRange = await prisma.product.aggregate({
      where: { shelfLevel: { not: null } },
      _min: { shelfLevel: true },
      _max: { shelfLevel: true },
    });
    console.log(`\n=== SHELF COORD RANGES ===`);
    console.log(`shelfNo: min=${shelfNoRange._min.shelfNo}, max=${shelfNoRange._max.shelfNo} (frontend loop: 1..10)`);
    console.log(`shelfLevel: min=${shelfLevelRange._min.shelfLevel}, max=${shelfLevelRange._max.shelfLevel} (frontend loop: 1..5)`);

    // 5. Out-of-range
    const outOfRangeShelfNo = await prisma.product.count({ where: { shelfNo: { gt: 10 } } });
    const outOfRangeShelfLevel = await prisma.product.count({ where: { shelfLevel: { gt: 5 } } });
    console.log(`\nProducts with shelfNo > 10 (EXCLUDED from grid): ${outOfRangeShelfNo}`);
    console.log(`Products with shelfLevel > 5 (EXCLUDED from grid): ${outOfRangeShelfLevel}`);

    // 6. Sections listing
    const sections = await prisma.section.findMany({
      select: { id: true, name: true, number: true },
      orderBy: { number: 'asc' },
    });
    console.log(`\n=== SECTIONS (total: ${sections.length}) ===`);
    sections.slice(0, 5).forEach(s => {
      console.log(`  id=${s.id?.slice(0,8)}..., name=${s.name}, number=${s.number}`);
    });

    // 7. Orphan section IDs in products (referencing deleted sections)
    const productSectionIds = await prisma.product.findMany({
      where: { sectionId: { not: null } },
      select: { sectionId: true },
      distinct: ['sectionId'],
    });
    const allSectionIdSet = new Set(sections.map(s => s.id));
    const orphans = productSectionIds.filter(p => !allSectionIdSet.has(p.sectionId));
    console.log(`\nOrphan sectionIds (products referencing non-existent sections): ${orphans.length}`);
    if (orphans.length > 0) {
      console.log('  Sample:', orphans.slice(0, 3).map(o => o.sectionId));
    }

    // 8. isListed/isActive stats
    const inactiveWithShelf = await prisma.product.count({
      where: {
        sectionId: { not: null },
        shelfSide: { not: null },
        shelfNo: { not: null },
        shelfLevel: { not: null },
        OR: [{ isActive: false }, { isListed: false }]
      }
    });
    console.log(`\nProducts with shelf coords but isActive=false OR isListed=false: ${inactiveWithShelf}`);
    console.log(`  (These are filtered out by universe=listed_active in productService)`);

  } catch (err) {
    console.error('ERROR:', err.message);
    console.error(err.stack);
  } finally {
    process.exit(0);
  }
}

main();
