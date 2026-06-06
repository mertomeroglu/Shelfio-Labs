import 'dotenv/config';
import { getPrisma, disconnectPrisma } from '../../src/providers/postgresProvider.js';
import { normalizeSearchText } from '../../src/utils/validators.js';

const main = async () => {
  const prisma = await getPrisma();
  console.log('Starting backfill for normalizedSearch...');

  // 1. Backfill Categories
  const categories = await prisma.category.findMany({
    select: { id: true, name: true }
  });
  console.log(`Found ${categories.length} categories to backfill.`);
  for (const item of categories) {
    const val = normalizeSearchText(item.name || '');
    await prisma.category.update({
      where: { id: item.id },
      data: { normalizedSearch: val }
    });
  }
  console.log('Categories backfilled.');

  // 2. Backfill Suppliers
  const suppliers = await prisma.supplier.findMany({
    select: { id: true, name: true }
  });
  console.log(`Found ${suppliers.length} suppliers to backfill.`);
  for (const item of suppliers) {
    const val = normalizeSearchText(item.name || '');
    await prisma.supplier.update({
      where: { id: item.id },
      data: { normalizedSearch: val }
    });
  }
  console.log('Suppliers backfilled.');

  // 3. Backfill SupplierProducts
  const supplierProducts = await prisma.supplierProduct.findMany({
    select: { id: true, supplierProductName: true }
  });
  console.log(`Found ${supplierProducts.length} supplier products to backfill.`);
  for (const item of supplierProducts) {
    const val = normalizeSearchText(item.supplierProductName || '');
    await prisma.supplierProduct.update({
      where: { id: item.id },
      data: { normalizedSearch: val }
    });
  }
  console.log('SupplierProducts backfilled.');

  // 4. Backfill Products
  const products = await prisma.product.findMany({
    select: { id: true, name: true, brand: true, etiket: true }
  });
  console.log(`Found ${products.length} products to backfill.`);
  for (const item of products) {
    const val = normalizeSearchText(`${item.name || ''} ${item.brand || ''} ${item.etiket || ''}`);
    await prisma.product.update({
      where: { id: item.id },
      data: { normalizedSearch: val }
    });
  }
  console.log('Products backfilled.');

  console.log('Backfill completed successfully!');
};

main()
  .catch((error) => {
    console.error('Backfill failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectPrisma();
  });
