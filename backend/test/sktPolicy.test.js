import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSktPolicy, SKT_POLICIES } from '../src/utils/sktPolicy.js';

test('marks electronics and bulbs as not applicable for SKT', () => {
  const policy = resolveSktPolicy({
    product: { name: 'Fujika 13 W Tas Ampul', etiket: 'Aydınlatma' },
    category: { code: 'ELKTR', name: 'Elektronik' },
  });

  assert.equal(policy.policy, SKT_POLICIES.NOT_APPLICABLE);
  assert.equal(policy.batchNoRequired, true);
});

test('keeps fresh and cold-chain food SKT required', () => {
  const policy = resolveSktPolicy({
    product: { name: 'Tam Yağlı Yoğurt', etiket: 'Yoğurt' },
    category: { code: 'SUTKH', name: 'Süt, Kahvaltılık' },
  });

  assert.equal(policy.policy, SKT_POLICIES.REQUIRED);
});

test('allows optional SKT for cleaning chemicals and batteries', () => {
  assert.equal(resolveSktPolicy({
    product: { name: 'Bulaşık Makinesi Tableti', etiket: 'Bulaşık' },
    category: { code: 'TMZLK', name: 'Deterjan, Temizlik' },
  }).policy, SKT_POLICIES.OPTIONAL);

  assert.equal(resolveSktPolicy({
    product: { name: 'Duracell AA Kalem Pil', etiket: 'Pil, Batarya' },
    category: { code: 'ELKTR', name: 'Elektronik' },
  }).policy, SKT_POLICIES.OPTIONAL);
});

test('flags category-label anomalies for manual review', () => {
  const policy = resolveSktPolicy({
    product: { name: 'Mutfak Gereç Seti', etiket: 'Mutfak Gereçleri' },
    category: { code: 'ICECK', name: 'İçecek' },
  });

  assert.equal(policy.policy, SKT_POLICIES.MANUAL_REVIEW);
});
