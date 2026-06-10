/**
 * warehouseStatusDryRun.js
 * DRY-RUN: Shows what would be updated to fix mojibake status values
 * in WarehouseLocation table. Run with: node scripts/warehouseStatusDryRun.js
 * 
 * NO actual writes are performed.
 */
import { getPrisma } from '../src/providers/postgresProvider.js';

const CORRUPTED_STATUS_MAP = {
  'Bo?': 'Boş',
  'Dolu': 'Dolu',  // already correct, no change needed
};

async function main() {
  const prisma = await getPrisma();
  try {
    console.log('\n=== DRY-RUN: WarehouseLocation Status Fix ===\n');

    // 1. Count all distinct statuses
    const statuses = await prisma.warehouseLocation.findMany({
      select: { status: true },
      distinct: ['status'],
    });
    console.log('All distinct status values:');
    statuses.forEach(s => {
      const hex = Buffer.from(s.status || '', 'utf8').toString('hex');
      const wouldFix = CORRUPTED_STATUS_MAP[s.status];
      const needsFix = wouldFix && wouldFix !== s.status;
      console.log(`  "${s.status}" (hex: ${hex}) → ${needsFix ? `WOULD BE FIXED → "${wouldFix}"` : 'OK (no change)'}`);
    });

    // 2. Count affected rows
    for (const [corrupted, fixed] of Object.entries(CORRUPTED_STATUS_MAP)) {
      if (corrupted === fixed) continue;
      const count = await prisma.warehouseLocation.count({
        where: { status: corrupted }
      });
      console.log(`\nRows with status="${corrupted}" that WOULD be updated to "${fixed}": ${count}`);
    }

    console.log('\n=== NO CHANGES MADE (dry-run only) ===');
    console.log('To apply the fix, the following SQL should be run:');
    console.log(`  UPDATE warehouse_locations SET status = 'Boş' WHERE status = 'Bo?';`);
    console.log('\nThis is safe to run — it only updates the status display string,');
    console.log('not any operational or financial data.\n');

  } catch (err) {
    console.error('ERROR:', err.message);
  } finally {
    process.exit(0);
  }
}

main();
