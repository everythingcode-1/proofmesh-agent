import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReceipts, verifyReceipts } from '../src/receipts.js';

test('receipt chain verifies for valid workflow', () => {
  const payload = { title: 'A', budget: 1000, urgency: 'high', impact: 'medium' };
  const result = {
    scoring: { urgencyScore: 3, impactScore: 2, budgetScore: 2, total: 7 },
    decision: 'APPROVE',
    confidence: 0.86,
    plan: ['x']
  };
  const receipts = buildReceipts({ taskId: 't1', payload, result });
  const verified = verifyReceipts(receipts);
  assert.equal(verified.ok, true);
  assert.equal(verified.steps, 4);
});

test('tampered receipt fails verification', () => {
  const payload = { title: 'A', budget: 1000, urgency: 'high', impact: 'medium' };
  const result = {
    scoring: { urgencyScore: 3, impactScore: 2, budgetScore: 2, total: 7 },
    decision: 'APPROVE',
    confidence: 0.86,
    plan: ['x']
  };
  const receipts = buildReceipts({ taskId: 't2', payload, result });
  receipts[2].reason = 'tampered';
  const verified = verifyReceipts(receipts);
  assert.equal(verified.ok, false);
});

test('rejects non-array receipts payload', () => {
  const verified = verifyReceipts({ not: 'array' });
  assert.equal(verified.ok, false);
  assert.match(verified.reason, /array/i);
});

test('detects invalid step ordering', () => {
  const payload = { title: 'B', budget: 2500, urgency: 'medium', impact: 'high' };
  const result = {
    scoring: { urgencyScore: 2, impactScore: 3, budgetScore: 2, total: 7 },
    decision: 'APPROVE',
    confidence: 0.87,
    plan: ['y']
  };

  const receipts = buildReceipts({ taskId: 't3', payload, result });
  receipts[1].stepIndex = 3;

  const verified = verifyReceipts(receipts);
  assert.equal(verified.ok, false);
  assert.match(verified.reason, /step index/i);
});

test('rejects unexpected receipt length', () => {
  const verified = verifyReceipts([]);
  assert.equal(verified.ok, false);
  assert.match(verified.reason, /length/i);
});

test('rejects modified step type and mixed public key', () => {
  const payload = { title: 'C', budget: 100, urgency: 'low', impact: 'medium' };
  const result = {
    scoring: { urgencyScore: 1, impactScore: 2, budgetScore: 1, total: 4 },
    decision: 'REJECT',
    confidence: 0.7,
    plan: ['z']
  };

  const receipts = buildReceipts({ taskId: 't4', payload, result });
  receipts[0].stepType = 'invalid-step';
  let verified = verifyReceipts(receipts);
  assert.equal(verified.ok, false);
  assert.match(verified.reason, /step type/i);

  const receipts2 = buildReceipts({ taskId: 't5', payload, result });
  receipts2[2].publicKey = '-----BEGIN PUBLIC KEY-----\nFAKE\n-----END PUBLIC KEY-----';
  verified = verifyReceipts(receipts2);
  assert.equal(verified.ok, false);
  assert.match(verified.reason, /publickey/i);
});
