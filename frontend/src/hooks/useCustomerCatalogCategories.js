import { useCallback, useEffect, useState } from 'react';
import { customerCatalogService } from '../services/customerCatalogService.js';

export function useCustomerCatalogCategories(initialCategories = []) {
  const [categories, setCategories] = useState(() => (
    Array.isArray(initialCategories) ? initialCategories : []
  ));
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const replaceCategories = useCallback((nextCategories) => {
    if (!Array.isArray(nextCategories)) return;
    setCategories(nextCategories);
    if (nextCategories.length > 0) setError(null);
  }, []);

  const ensureCategories = useCallback(async ({ force = false } = {}) => {
    if (!force && categories.length > 0) return categories;

    setIsLoading(true);
    setError(null);
    try {
      const nextCategories = await customerCatalogService.getCategories({ force });
      setCategories(Array.isArray(nextCategories) ? nextCategories : []);
      return Array.isArray(nextCategories) ? nextCategories : [];
    } catch (err) {
      setError(err);
      return [];
    } finally {
      setIsLoading(false);
    }
  }, [categories]);

  useEffect(() => {
    if (categories.length > 0) return;
    void ensureCategories();
  }, [categories.length, ensureCategories]);

  return {
    categories,
    setCategories: replaceCategories,
    ensureCategories,
    isLoading,
    error,
  };
}
