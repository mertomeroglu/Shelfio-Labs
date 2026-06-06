import { describe, expect, it, vi } from 'vitest';
import { buildLicenseOverview, formatLicenseExpiryDisplay } from './SettingsCampaignShell.jsx';

describe('license expiry display', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-03T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows a readable date when expiresAt is present', () => {
    expect(formatLicenseExpiryDisplay({ expiresAt: '2026-06-09T00:00:00.000Z' })).toBe('09 Haziran 2026');
  });

  it('reads defensive expiry field names', () => {
    expect(formatLicenseExpiryDisplay({ validUntil: '2026-06-04T00:00:00.000Z' })).toBe('04 Haziran 2026');
    expect(formatLicenseExpiryDisplay({ renewalDate: '2026-06-05T00:00:00.000Z' })).toBe('05 Haziran 2026');
    expect(formatLicenseExpiryDisplay({ expires_at: '2026-06-06T00:00:00.000Z' })).toBe('06 Haziran 2026');
  });

  it('shows indefinite text for non-expiring standard licenses', () => {
    expect(formatLicenseExpiryDisplay({ planCode: 'enterprise', expiresAt: null })).toBe('∞ Süresiz');
  });

  it('shows demo expiry with remaining days', () => {
    expect(formatLicenseExpiryDisplay(
      { planCode: 'demo', expiresAt: '2026-06-09T00:00:00.000Z' },
      { isDemo: true, remainingDays: 6 },
    )).toBe('09 Haziran 2026 · 6 gün kaldı');
  });

  it('shows an expired state without crashing', () => {
    expect(formatLicenseExpiryDisplay({ expiresAt: '2026-06-02T00:00:00.000Z' })).toBe('02 Haziran 2026 · Süresi doldu');
    expect(formatLicenseExpiryDisplay({ status: 'expired', expiresAt: null })).toBe('Süresi doldu');
  });

  it('builds overview from license summary when the license object lacks expiresAt', () => {
    const overview = buildLicenseOverview({
      license: { status: 'active', planCode: 'demo' },
      licenseSummary: { expires_at: '2026-06-09T00:00:00.000Z', isDemo: true, remainingDays: 6 },
    });

    expect(overview.expiresAt).toBe('09 Haziran 2026 · 6 gün kaldı');
  });

  it('keeps the UI stable when license summary is missing', () => {
    const overview = buildLicenseOverview({});
    expect(overview.expiresAt).toBe('∞ Süresiz');
    expect(overview.plan).toBe('-');
  });
});
