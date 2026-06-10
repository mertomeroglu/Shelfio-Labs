import { getPrisma } from './src/providers/postgresProvider.js';

async function main() {
  const prisma = await getPrisma();
  const stores = await prisma.store.findMany();
  console.log('Stores in DB:', JSON.stringify(stores, null, 2));
}

main()
  .catch(console.error)
  .finally(() => process.exit(0));
