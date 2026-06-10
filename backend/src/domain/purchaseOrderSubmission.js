export const resolvePurchaseOrderSubmission = (payload = {}) => {
  const requestedMode = String(payload.submitMode || '').trim().toLowerCase();
  const submitMode = requestedMode === 'draft'
    || (!requestedMode && payload.approvalRequested === false)
    ? 'draft'
    : 'approval';
  const approvalRequested = submitMode === 'approval';

  return {
    submitMode,
    approvalRequested,
    initialStatus: approvalRequested ? 'submitted_for_approval' : 'draft',
  };
};
