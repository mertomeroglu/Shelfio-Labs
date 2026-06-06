import { useEffect, useState } from 'react';
import { productService } from '../services/productService.js';

export function usePersonnelProductSearch(query, options = {}) {
  const minLength = Number(options.minLength || 2);
  const limit = Number(options.limit || 20);
  const enabled = options.enabled !== false;
  const [results, setResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    const search = String(query || '').trim();
    if (!enabled || search.length < minLength) {
      setResults([]);
      setIsSearching(false);
      setError(null);
      return undefined;
    }

    let active = true;
    setIsSearching(true);
    setError(null);

    const timer = window.setTimeout(async () => {
      try {
        const rows = await productService.searchForPersonnel(search, { limit });
        if (!active) return;
        setResults(Array.isArray(rows) ? rows : []);
      } catch (searchError) {
        if (!active) return;
        setResults([]);
        setError(searchError);
      } finally {
        if (active) setIsSearching(false);
      }
    }, 250);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [enabled, limit, minLength, query]);

  return { results, isSearching, error };
}
