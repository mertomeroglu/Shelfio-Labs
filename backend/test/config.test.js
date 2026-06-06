import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePublicApiBaseUrl } from '../src/config/config.js';

test('resolvePublicApiBaseUrl prefers explicit public API base URL', () => {
  const url = resolvePublicApiBaseUrl({
    PUBLIC_API_BASE_URL: 'https://api.shelfiolabs.com/',
    MAIN_APP_URL: 'https://shelfiolabs.com',
    PORT: '4000',
  }, 'production');

  assert.equal(url, 'https://api.shelfiolabs.com');
});

test('resolvePublicApiBaseUrl falls back to public Shelfio domain in production', () => {
  const url = resolvePublicApiBaseUrl({ PORT: '4000' }, 'production');

  assert.equal(url, 'https://shelfiolabs.com');
});

test('resolvePublicApiBaseUrl keeps localhost fallback outside production', () => {
  const url = resolvePublicApiBaseUrl({ PORT: '4100' }, 'development');

  assert.equal(url, 'http://localhost:4100');
});
