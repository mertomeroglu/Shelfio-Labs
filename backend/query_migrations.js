import { getPrisma } from './src/providers/postgresProvider.js';

async function main() {
  const prisma = await getPrisma();
  const migrations = await prisma.$queryRaw`SELECT * FROM _prisma_migrations ORDER BY started_at DESC`;
  console.log(JSON.stringify(migrations, null, 2));
}

main()
  .catch(console.error)
  .finally(() => process.exit(0));
