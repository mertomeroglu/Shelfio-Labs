import { useMemo, useState } from 'react';

export function usePurchaseSuggestionActions() {
  const [processingId, setProcessingId] = useState('');

  const isGeneratingSuggestions = useMemo(
    () => ['manual', 'generate'].includes(processingId),
    [processingId],
  );

  const isBulkProcessing = useMemo(
    () => processingId.startsWith('bulk-'),
    [processingId],
  );

  return {
    processingId,
    setProcessingId,
    isGeneratingSuggestions,
    isBulkProcessing,
  };
}
