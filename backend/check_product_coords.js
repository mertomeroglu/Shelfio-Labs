import { getPrisma } from './src/providers/postgresProvider.js';

async function main() {
  const prisma = await getPrisma();
  
  const totalProducts = await prisma.product.count();
  const productsWithCoords = await prisma.product.count({
    where: {
      sectionId: { not: null },
      shelfSide: { not: null },
      shelfNo: { not: null },
      shelfLevel: { not: null }
    }
  });

  const productsWithDepot = await prisma.product.count({
    where: {
      depotLocationCode: { not: null }
    }
  });

  console.log(`Total Products: ${totalProducts}`);
  console.log(`Products with shelf coordinates: ${productsWithCoords}`);
  console.log(`Products with depot code: ${productsWithDepot}`);
  
  // Sample products with coordinates
  const sample = await prisma.product.findMany({
    where: {
      sectionId: { not: null }
    },
    select: {
      id: true,
      name: true,
      sku: true,
      sectionId: true,
      shelfSide: true,
      shelfNo: true,
      shelfLevel: true,
      updatedAt: true
    },
    take: 5
  });

  console.log('Sample shelf products:', JSON.stringify(sample, null, 2));
}

main()
  .catch(console.error)
  .finally(() => process.exit(0));
