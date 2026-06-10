import { productService } from '../src/services/productService.js';
import { getPrisma } from '../src/providers/postgresProvider.js';

async function main() {
  console.log('--- Calling productService.list({ view: "location_management" }) ---');
  const result = await productService.list({ view: 'location_management' });
  console.log('Result type:', typeof result);
  console.log('Result length:', Array.isArray(result) ? result.length : 'not an array');
  if (Array.isArray(result) && result.length > 0) {
    console.log('First item sample:', JSON.stringify(result[0], null, 2));
  }
}

main()
  .catch(console.error)
  .finally(async () => {
    try {
      const { disconnectPrisma } = await import('../src/providers/postgresProvider.js');
      await disconnectPrisma();
    } catch(e){}
  });
