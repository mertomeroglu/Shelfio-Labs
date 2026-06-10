/**
 * diagnoseWarehouse.js - checks warehouse location status values for encoding issues
 */
import { getPrisma } from '../src/providers/postgresProvider.js';

async function main() {
  const prisma = await getPrisma();
  try {
    const total = await prisma.warehouseLocation.count();
    console.log(`Total warehouse locations: ${total}`);

    // Check distinct status values
    const statuses = await prisma.warehouseLocation.findMany({
      select: { status: true },
      distinct: ['status'],
    });
    console.log('\nDistinct status values in DB:');
    statuses.forEach(s => {
      const hex = Buffer.from(s.status || '', 'utf8').toString('hex');
      console.log(`  "${s.status}" (hex: ${hex})`);
    });

    // Sample 3 locations
    const samples = await prisma.warehouseLocation.findMany({
      take: 3,
      select: { id: true, locationCode: true, status: true, rowNo: true, side: true, shelfNo: true, shelfLevel: true }
    });
    console.log('\nSample warehouse locations:');
    samples.forEach(s => console.log(s));

  } catch (err) {
    console.error('ERROR:', err.message);
  } finally {
    process.exit(0);
  }
}

main();
