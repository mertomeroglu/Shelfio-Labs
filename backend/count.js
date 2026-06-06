import { getPrisma } from './src/providers/postgresProvider.js';

async function main() {
  const prisma = await getPrisma();
  const count = await prisma.product.count();
  console.log('Total Products in Postgres:', count);
}
main().catch(console.error).finally(() => process.exit(0));
