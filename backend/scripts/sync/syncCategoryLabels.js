import { categoryLabelService } from '../../src/services/categoryLabelService.js';

const run = async () => {
  const result = await categoryLabelService.syncAuthoritative();
  const summary = {
    authoritativeCount: result.authoritativeCount,
    migratedProductCount: result.migratedProductCount,
    brokenProductReferenceFixedCount: result.brokenProductReferenceFixedCount,
    unresolvedProductLabelCount: result.unresolvedProductLabelCount,
    duplicateLabelsByName: result.audit?.duplicateLabelsByName?.length || 0,
    sameCodeMappedToMultipleLabels: result.audit?.sameCodeMappedToMultipleLabels?.length || 0,
    slugCollisions: result.audit?.slugCollisions?.length || 0,
    productWithoutMasterLabel: result.audit?.productWithoutMasterLabel?.length || 0,
  };
  console.log(JSON.stringify(summary, null, 2));
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
