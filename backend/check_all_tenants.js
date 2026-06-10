import { getPrisma } from './src/providers/postgresProvider.js';

async function main() {
  const prisma = await getPrisma();
  
  console.log("All tenants in DB:");
  const tenants = await prisma.$queryRaw`SELECT id, name, slug, status FROM tenants`;
  console.log(JSON.stringify(tenants, null, 2));

  console.log("\nAll layouts in DB (bypassing tenant filter):");
  const layouts = await prisma.$queryRaw`SELECT id, name, status, version, store_id, tenant_id, created_at, updated_at FROM store_layouts`;
  console.log(JSON.stringify(layouts, null, 2));
}

main()
  .catch(console.error)
  .finally(() => process.exit(0));
