import { getPrisma, disconnectPrisma } from '../src/providers/postgresProvider.js';

async function main() {
  const prisma = await getPrisma();
  console.log('Inspecting Category rows...');
  const categories = await prisma.category.findMany();
  console.log('Categories:', JSON.stringify(categories, null, 2));

  console.log('Inspecting Product etiket values...');
  const etiketGroups = await prisma.product.groupBy({
    by: ['etiket'],
    _count: { _all: true }
  });
  console.log('Product etiket distribution:', JSON.stringify(etiketGroups, null, 2));
}

main().catch(console.error).finally(disconnectPrisma);
