import { getPrisma } from '../src/providers/postgresProvider.js';
import { supplierService } from '../src/services/supplierService.js';
import { runWithTenantContext } from '../src/tenant/tenantContext.js';

async function main() {
  const start = Date.now();
  try {
    const prisma = await getPrisma();
    console.log('Database connected.');

    console.log('Calling supplierService.list...');
    const result = await runWithTenantContext({ tenantId: 'tenant_main_shelfio', storeId: 'store-main' }, async () => {
      return await supplierService.list();
    });

    const end = Date.now();
    console.log(`\nSuccess! supplierService.list resolved in ${end - start} ms.`);
    console.log(`Total suppliers found: ${result?.length}`);
  } catch (err) {
    const end = Date.now();
    console.error(`\nFailed in ${end - start} ms:`, err);
  }
}

main();
