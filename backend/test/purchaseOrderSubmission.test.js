import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePurchaseOrderSubmission } from '../src/domain/purchaseOrderSubmission.js';

test('draft submit mode creates a draft without approval request', () => {
  assert.deepEqual(resolvePurchaseOrderSubmission({ submitMode: 'draft', approvalRequested: false }), {
    submitMode: 'draft',
    approvalRequested: false,
    initialStatus: 'draft',
  });
});

test('approval submit mode creates a submitted approval request', () => {
  assert.deepEqual(resolvePurchaseOrderSubmission({ submitMode: 'approval', approvalRequested: true }), {
    submitMode: 'approval',
    approvalRequested: true,
    initialStatus: 'submitted_for_approval',
  });
});

test('legacy approvalRequested false remains a draft', () => {
  assert.equal(resolvePurchaseOrderSubmission({ approvalRequested: false }).initialStatus, 'draft');
});
