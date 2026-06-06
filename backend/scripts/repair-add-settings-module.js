import { getPrisma } from '../src/providers/postgresProvider.js';

async function main() {
  console.log('[Repair Script] Starting license modules update...');
  let prisma;
  try {
    prisma = await getPrisma();
  } catch (err) {
    console.error('[Repair Script] Failed to initialize Prisma Client:', err.message);
    process.exit(1);
  }

  try {
    const licenses = await prisma.license.findMany();
    console.log(`[Repair Script] Found ${licenses.length} licenses in database.`);

    let updatedCount = 0;

    for (const license of licenses) {
      const currentModules = Array.isArray(license.enabledModules) ? license.enabledModules : [];
      const requiredModules = ['settings', 'notifications', 'support'];
      const missingModules = requiredModules.filter(mod => !currentModules.includes(mod));

      if (missingModules.length > 0) {
        const nextModules = Array.from(new Set([...currentModules, ...requiredModules]));
        
        await prisma.license.update({
          where: { id: license.id },
          data: { enabledModules: nextModules }
        });

        console.log(`[Repair Script] License updated successfully. License ID (UUID): ${license.id}, Plan Code: ${license.planCode || 'N/A'}`);
        updatedCount++;
      }
    }

    console.log(`[Repair Script] Operation completed. Total licenses updated: ${updatedCount}`);
  } catch (error) {
    console.error('[Repair Script] Error during database operations:', error);
  } finally {
    if (prisma) {
      await prisma.$disconnect();
    }
  }
}

main().catch(err => {
  console.error('[Repair Script] Fatal error:', err);
  process.exit(1);
});
