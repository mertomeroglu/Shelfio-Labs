import { procurementService } from '../src/services/procurementService.js';
import { runWithTenantContext } from '../src/tenant/tenantContext.js';

async function main() {
  try {
    console.log('Testing listOrders pagination...');
    let page = 1;
    let hasNextPage = true;
    const limit = 250;

    await runWithTenantContext({ tenantId: 'tenant_main_shelfio', storeId: 'store-main' }, async () => {
      while (hasNextPage) {
        console.log(`Fetching page ${page}...`);
        const start = Date.now();
        const result = await procurementService.listOrders({
          paginationMode: 'offset',
          page,
          limit,
          includeTotal: true
        });
        const duration = Date.now() - start;

        const itemsLength = result.items?.length ?? 0;
        const total = result.pagination?.total;
        hasNextPage = result.pagination?.hasNextPage;
        
        console.log(`Page ${page} fetched in ${duration} ms. Items: ${itemsLength}, Total: ${total}, hasNextPage: ${hasNextPage}`);

        page += 1;
        if (page > 10) {
          console.log('Force breaking to prevent infinite loop in test');
          break;
        }
      }
    });

    console.log('Done.');
  } catch (err) {
    console.error('Error during pagination test:', err);
  }
}

main();
