import { useCallback, useEffect, useState } from 'react';
import { customerCatalogService } from '../services/customerCatalogService.js';

let cachedCategories = null;
let lastFetchedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes cache

export function useCustomerCatalogCategories(initialCategories = []) {
  const [categories, setCategories] = useState(() => {
    if (Array.isArray(cachedCategories)) return cachedCategories;
    return Array.isArray(initialCategories) ? initialCategories : [];
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const replaceCategories = useCallback((nextCategories) => {
    if (!Array.isArray(nextCategories)) return;
    setCategories(nextCategories);
    cachedCategories = nextCategories;
    lastFetchedAt = Date.now();
    if (nextCategories.length > 0) setError(null);
  }, []);

  const ensureCategories = useCallback(async ({ force = false } = {}) => {
    const now = Date.now();
    if (!force && cachedCategories && (now - lastFetchedAt < CACHE_TTL_MS)) {
      setCategories(cachedCategories);
      return cachedCategories;
    }
    if (!force && categories.length > 0) {
      cachedCategories = categories;
      lastFetchedAt = now;
      return categories;
    }

    setIsLoading(true);
    setError(null);
    try {
      const nextCategories = await customerCatalogService.getCategories({ force });
      const list = Array.isArray(nextCategories) ? nextCategories : [];
      setCategories(list);
      cachedCategories = list;
      lastFetchedAt = Date.now();
      return list;
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
