import { getPrisma } from './src/providers/postgresProvider.js';

async function main() {
  const prisma = await getPrisma();
  
  const layouts = await prisma.storeLayout.findMany({
    include: { _count: { select: { items: true } } },
    orderBy: { updatedAt: 'desc' }
  });

  for (const layout of layouts) {
    console.log(`Layout ID: ${layout.id}`);
    console.log(`  Name: ${layout.name}`);
    console.log(`  Status: ${layout.status}`);
    console.log(`  Version: ${layout.version}`);
    console.log(`  UpdatedAt: ${layout.updatedAt.toISOString()}`);
    console.log(`  Item Count: ${layout._count.items}`);
    
    // Sample coordinate check for a few reyon items
    const items = await prisma.storeLayoutItem.findMany({
      where: { layoutId: layout.id, objectType: 'section' },
      orderBy: { label: 'asc' },
      take: 3
    });
    console.log(`  Sample sections:`);
    items.forEach(it => {
      console.log(`    "${it.label}": x=${it.x}, y=${it.y}, w=${it.width}, h=${it.height}`);
    });
  }
}

main()
  .catch(console.error)
  .finally(() => process.exit(0));
