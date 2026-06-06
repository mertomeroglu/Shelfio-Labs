import { useEffect, useState } from 'react';

export function useFetch(fetcher, { immediate = true, initialData = null, deps = [] } = {}) {
  const [data, setData] = useState(initialData);
  const [isLoading, setIsLoading] = useState(immediate);
  const [error, setError] = useState('');

  const execute = async (...args) => {
    setIsLoading(true);
    setError('');

    try {
      const result = await fetcher(...args);
      setData(result);
      return result;
    } catch (requestError) {
      setError(requestError.message || 'Bir hata oluştu');
      throw requestError;
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!immediate) {
      return;
    }

    execute();
  }, deps);

  return {
    data,
    setData,
    isLoading,
    error,
    setError,
    execute,
  };
}

