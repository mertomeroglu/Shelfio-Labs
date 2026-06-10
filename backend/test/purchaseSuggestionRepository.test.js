import test from 'node:test';
import assert from 'node:assert/strict';

import { createPurchaseSuggestionRepository } from '../src/repositories/purchaseSuggestionRepository.js';

test('purchase suggestion repository preserves eligibility diagnostics', async () => {
  let persistedData;
  const client = {
    purchaseSuggestion: {
      async create({ data }) {
        persistedData = data;
        return data;
      },
    },
  };
  const repository = createPurchaseSuggestionRepository(client);
  const eligibility = {
    eligible: false,
    status: 'skipped',
    reasonCode: 'inbound_covered',
    reasonText: 'Yoldaki sipariş mevcut ihtiyacı karşılıyor',
    demandDataAvailable: true,
    minimumStockAvailable: true,
    leadTimeAvailable: true,
    orderDataComplete: true,
    inboundCoversNeed: true,
    modeEligible: true,
  };

  const created = await repository.create({
    id: 'suggestion-contract-test',
    productId: 'product-1',
    status: 'skipped',
    confidenceScore: 88,
    eligibility,
  });

  assert.equal(persistedData.payload.contractVersion, 2);
  assert.equal(persistedData.payload.calculation.confidenceScore, 88);
  assert.deepEqual(persistedData.payload.calculation.eligibility, eligibility);
  assert.equal(created.confidenceScore, 88);
  assert.deepEqual(created.eligibility, eligibility);
});
