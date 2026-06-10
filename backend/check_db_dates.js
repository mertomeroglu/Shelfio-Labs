import { getPrisma } from './src/providers/postgresProvider.js';

async function main() {
  const prisma = await getPrisma();
  
  const tables = ['Product', 'Section', 'WarehouseLocation', 'User', 'Tenant', 'Store'];
  
  for (const table of tables) {
    try {
      const records = await prisma[table.charAt(0).toLowerCase() + table.slice(1)].findMany({
        orderBy: { createdAt: 'asc' },
        take: 1
      });
      if (records.length > 0) {
        console.log(`${table}: oldest record createdAt is ${records[0].createdAt.toISOString()}`);
      } else {
        console.log(`${table}: no records`);
      }
    } catch (err) {
      console.log(`${table}: error reading or field missing: ${err.message}`);
    }
  }
}

main()
  .catch(console.error)
  .finally(() => process.exit(0));
