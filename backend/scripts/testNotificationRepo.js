import { getPrisma } from '../src/providers/postgresProvider.js';
import { notificationRepo } from '../src/repositories/notificationRepository.js';
import { runWithTenantContext } from '../src/tenant/tenantContext.js';

async function main() {
  try {
    const prisma = await getPrisma();
    console.log('Database connected.');

    await runWithTenantContext({ tenantId: 'tenant_main_shelfio', storeId: 'store-main' }, async () => {
      console.log('Counting notifications in DB...');
      const dbCount = await prisma.notification.count({
        where: { tenantId: 'tenant_main_shelfio' }
      });
      console.log(`Total notifications in DB: ${dbCount}`);

      console.log('Calling notificationRepo.getAll()...');
      const start = Date.now();
      const all = await notificationRepo.getAll();
      const end = Date.now();
      console.log(`getAll() completed in ${end - start} ms. Count: ${all.length}`);

      console.log('Calling notificationRepo.create()...');
      const createStart = Date.now();
      const newNotif = await notificationRepo.create({
        userId: 'user-admin-main',
        type: 'test_notification',
        title: 'Diagnostic Test',
        message: 'This is a test notification',
        severity: 'low',
        isRead: false
      });
      const createEnd = Date.now();
      console.log(`create() completed in ${createEnd - createStart} ms. New ID: ${newNotif.id}`);
    });
  } catch (err) {
    console.error('Error during notification repo test:', err);
  }
}

main();
