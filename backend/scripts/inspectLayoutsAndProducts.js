import { getPrisma } from '../src/providers/postgresProvider.js';

async function main() {
  const prisma = await getPrisma();
  const activeLayout = await prisma.storeLayout.findFirst({
    where: { status: 'published' }
  });
  if (!activeLayout) {
    console.log('No active layout');
    return;
  }

  const shelfItems = await prisma.storeLayoutItem.findMany({
    where: {
      layoutId: activeLayout.id,
      objectType: 'shelf'
    },
    take: 5
  });
  console.log('Sample shelf items:', JSON.stringify(shelfItems, null, 2));
}

main()
  .catch(console.error)
  .finally(async () => {
    try {
      const { disconnectPrisma } = await import('../src/providers/postgresProvider.js');
      await disconnectPrisma();
    } catch(e){}
  });
