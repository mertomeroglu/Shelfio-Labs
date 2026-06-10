import { getPrisma } from './src/providers/postgresProvider.js';

async function main() {
  const prisma = await getPrisma();
  const layouts = await prisma.storeLayout.findMany({
    select: {
      id: true,
      name: true,
      status: true,
      version: true,
      storeId: true,
      createdAt: true,
      updatedAt: true,
    }
  });
  console.log("Database Layouts:");
  console.log(JSON.stringify(layouts, null, 2));
}

main()
  .catch(console.error)
  .finally(() => process.exit(0));
