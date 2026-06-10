import { describe, expect, it } from 'vitest';
import { parseMobileOrderHandoffScan } from './POS.jsx';

describe('parseMobileOrderHandoffScan', () => {
  it('routes a customer mobile order QR payload', () => {
    expect(parseMobileOrderHandoffScan(
      JSON.stringify({ type: 'mobile_order_handoff', code: 'mbl-ab1234' })
    )).toBe('MBL-AB1234');
  });

  it('leaves product barcodes and unrelated QR payloads alone', () => {
    expect(parseMobileOrderHandoffScan('8691234567890')).toBe('');
    expect(parseMobileOrderHandoffScan(
      JSON.stringify({ type: 'product', code: 'MBL-AB1234' })
    )).toBe('');
    expect(parseMobileOrderHandoffScan('{invalid')).toBe('');
  });
});
