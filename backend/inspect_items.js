import { getPrisma } from './src/providers/postgresProvider.js';

async function main() {
  const prisma = await getPrisma();
  
  // Find published and draft layouts
  const publishedLayout = await prisma.storeLayout.findFirst({
    where: { status: 'published' },
    include: { items: true }
  });
  
  const draftLayout = await prisma.storeLayout.findFirst({
    where: { status: 'draft' },
    include: { items: true }
  });

  console.log('Published Layout ID:', publishedLayout?.id);
  console.log('Published Items count:', publishedLayout?.items?.length);
  
  console.log('Draft Layout ID:', draftLayout?.id);
  console.log('Draft Items count:', draftLayout?.items?.length);

  if (publishedLayout && draftLayout) {
    console.log('Comparing items coordinates:');
    const pubItemsMap = new Map(publishedLayout.items.map(item => [item.label || item.id, item]));
    const draftItemsMap = new Map(draftLayout.items.map(item => [item.label || item.id, item]));

    let diffCount = 0;
    for (const [label, pubItem] of pubItemsMap.entries()) {
      const draftItem = draftItemsMap.get(label);
      if (!draftItem) {
        console.log(`Item only in Published: ${label}`);
        diffCount++;
      } else {
        if (pubItem.x !== draftItem.x || pubItem.y !== draftItem.y || pubItem.width !== draftItem.width || pubItem.height !== draftItem.height) {
          console.log(`Item coordinate diff for "${label}":`);
          console.log(`  Published: x=${pubItem.x}, y=${pubItem.y}, w=${pubItem.width}, h=${pubItem.height}`);
          console.log(`  Draft:     x=${draftItem.x}, y=${draftItem.y}, w=${draftItem.width}, h=${draftItem.height}`);
          diffCount++;
        }
      }
    }
    
    for (const label of draftItemsMap.keys()) {
      if (!pubItemsMap.has(label)) {
        console.log(`Item only in Draft: ${label}`);
        diffCount++;
      }
    }
    
    console.log(`Total item differences: ${diffCount}`);
  }
}

main()
  .catch(console.error)
  .finally(() => process.exit(0));
