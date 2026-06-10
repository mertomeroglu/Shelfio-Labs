import { getPrisma } from '../src/providers/postgresProvider.js';
import { procurementService } from '../src/services/procurementService.js';
import { supplierService } from '../src/services/supplierService.js';
import { runWithTenantContext } from '../src/tenant/tenantContext.js';

async function main() {
  try {
    const prisma = await getPrisma();
    console.log('Database connected.');

    await runWithTenantContext({ tenantId: 'tenant_main_shelfio', storeId: 'store-main' }, async () => {
      // Find a suitable order (e.g. submitted_for_approval, approved, etc.)
      const activeOrder = await prisma.purchaseOrder.findFirst({
        where: {
          status: {
            notIn: ['completed', 'archived', 'cancelled']
          }
        },
        select: {
          id: true,
          status: true,
          orderNumber: true
        }
      });

      if (!activeOrder) {
        console.log('No active orders found to test status update.');
        return;
      }

      console.log(`Testing with Order ID: ${activeOrder.id}, Status: ${activeOrder.status}, Number: ${activeOrder.orderNumber}`);

      // Try updating status (or simulating it)
      // Let's call procurementService.updateOrderStatus
      // Wait, let's determine next status
      const currentStatus = activeOrder.status;
      let nextStatus = currentStatus;
      if (currentStatus === 'submitted_for_approval') {
        nextStatus = 'approved';
      } else if (currentStatus === 'approved') {
        nextStatus = 'supplier_notified';
      } else if (currentStatus === 'supplier_notified') {
        nextStatus = 'preparing';
      } else if (currentStatus === 'preparing') {
        nextStatus = 'ready_to_ship';
      } else {
        console.log(`Order status is ${currentStatus}. We'll try to update to the same status to check if it hangs.`);
      }

      console.log(`Updating status to ${nextStatus}...`);
      const updateStart = Date.now();
      
      try {
        const updateResult = await procurementService.updateOrderStatus(activeOrder.id, {
          status: nextStatus,
          note: 'Diagnostic Status Update Test'
        }, 'user-admin-main');
        console.log(`Status updated in ${Date.now() - updateStart} ms.`);
      } catch (err) {
        console.log(`Status update failed (expected if transition not allowed/already done): ${err.message}`);
      }

      // Now call listAllOrders and supplierService.list
      console.log('Calling procurementService.listOrders...');
      const listStart = Date.now();
      const orders = await procurementService.listOrders({
        paginationMode: 'offset',
        page: 1,
        limit: 250,
        includeTotal: true
      });
      console.log(`listOrders completed in ${Date.now() - listStart} ms. Count: ${orders.items?.length}`);

      console.log('Calling supplierService.list...');
      const supplierStart = Date.now();
      const suppliers = await supplierService.list();
      console.log(`supplierService.list completed in ${Date.now() - supplierStart} ms. Count: ${suppliers?.length}`);

    });
  } catch (err) {
    console.error('Error during test:', err);
  }
}

main();
