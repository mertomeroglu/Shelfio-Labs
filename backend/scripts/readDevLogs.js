import { getPrisma } from '../src/providers/postgresProvider.js';
import { runWithTenantContext } from '../src/tenant/tenantContext.js';

async function main() {
  try {
    const prisma = await getPrisma();
    console.log('Database connected.');

    const settings = await runWithTenantContext({ tenantId: 'tenant_main_shelfio', storeId: 'store-main' }, async () => {
      return await prisma.setting.findFirst({
        where: {
          tenantId: 'tenant_main_shelfio'
        }
      });
    });

    if (!settings) {
      console.log('No settings row found');
      return;
    }

    const payload = settings.payload || {};
    const logs = Array.isArray(payload.developerLogs) ? payload.developerLogs : [];
    
    console.log(`Total developer logs count: ${logs.length}`);
    console.log('\n--- LAST 20 DEVELOPER LOGS ---');
    const last20 = logs.slice(-20).reverse();
    last20.forEach((log, index) => {
      console.log(`\n[${index + 1}] Timestamp: ${log.timestamp}`);
      console.log(`Source: ${log.source} | Level: ${log.level}`);
      console.log(`Action: ${log.action}`);
      console.log(`Message: ${log.message}`);
      if (log.stack) {
        console.log(`Stack: ${log.stack.split('\\n').slice(0, 3).join('\\n')}`);
      }
    });
  } catch (err) {
    console.error('Error reading logs:', err);
  }
}

main();
