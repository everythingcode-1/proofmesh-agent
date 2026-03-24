import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let server;
let base;
let tmpDataDir;

test.before(async () => {
  tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proofmesh-test-'));
  process.env.PROOFMESH_DATA_DIR = tmpDataDir;

  const { startServer } = await import('../src/server.js');
  const port = 8989;
  server = startServer({ port });
  base = `http://localhost:${port}`;
  await new Promise((r) => setTimeout(r, 120));
});

test.after(() => {
  server?.close();
  fs.rmSync(tmpDataDir, { recursive: true, force: true });
  delete process.env.PROOFMESH_DATA_DIR;
});

test('health endpoint works', async () => {
  const res = await fetch(`${base}/api/health`);
  const data = await res.json();
  assert.equal(data.ok, true);
});

test('create task and verify', async () => {
  const created = await fetch(`${base}/api/tasks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'API Test', budget: 3000, urgency: 'high', impact: 'high' })
  }).then((r) => r.json());

  assert.equal(created.ok, true);
  assert.ok(created.task.id);

  const ver = await fetch(`${base}/api/tasks/${created.task.id}/verify`).then((r) => r.json());
  assert.equal(ver.ok, true);
  assert.equal(ver.verification.ok, true);
});

test('returns stats and supports list limit/offset pagination', async () => {
  await fetch(`${base}/api/tasks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Stats 1', budget: 10, urgency: 'low', impact: 'low' })
  });

  await fetch(`${base}/api/tasks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Stats 2', budget: 20000, urgency: 'high', impact: 'high' })
  });

  const listRes = await fetch(`${base}/api/tasks?limit=1&offset=1`);
  const list = await listRes.json();

  assert.equal(list.ok, true);
  assert.equal(list.limit, 1);
  assert.equal(list.offset, 1);
  assert.equal(list.tasks.length, 1);
  assert.equal(typeof list.hasMore, 'boolean');
  assert.ok(list.total >= 2);

  const statsRes = await fetch(`${base}/api/stats`);
  const stats = await statsRes.json();

  assert.equal(stats.ok, true);
  assert.ok(stats.stats.total >= 2);
  assert.ok(Number.isFinite(stats.stats.avgConfidence));
  assert.equal(typeof stats.stats.createdLast24h, 'number');
  assert.ok(stats.stats.confidenceBands);
  assert.equal(typeof stats.stats.confidenceBands.high, 'number');
});

test('replay-audit proves deterministic receipts for persisted task', async () => {
  const created = await fetch(`${base}/api/tasks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Replay Audit', budget: 1234, urgency: 'high', impact: 'medium' })
  }).then((r) => r.json());

  const res = await fetch(`${base}/api/tasks/${created.task.id}/replay-audit`);
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.audit.ok, true);
  assert.equal(body.audit.storedVerification.ok, true);
  assert.equal(body.audit.regeneratedVerification.ok, true);
  assert.equal(body.audit.storedHash, body.audit.regeneratedHash);
});

test('rejects malformed JSON body', async () => {
  const res = await fetch(`${base}/api/tasks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"title": "oops"'
  });

  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.ok, false);
  assert.match(data.error, /invalid json/i);
});

test('rejects requests without JSON content-type', async () => {
  const res = await fetch(`${base}/api/tasks`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: JSON.stringify({ title: 'No json content type' })
  });

  assert.equal(res.status, 415);
  const data = await res.json();
  assert.equal(data.ok, false);
  assert.match(data.error, /content-type/i);
});

test('rejects oversized payloads', async () => {
  const hugeDescription = 'x'.repeat(70 * 1024);
  const res = await fetch(`${base}/api/tasks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Huge payload', description: hugeDescription })
  });

  assert.equal(res.status, 413);
  const data = await res.json();
  assert.equal(data.ok, false);
  assert.match(data.error, /payload too large/i);
});

test('rejects invalid task payload with clear 400 error', async () => {
  const res = await fetch(`${base}/api/tasks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Bad payload', budget: -100, urgency: 'critical' })
  });

  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.ok, false);
  assert.match(data.error, /(budget|urgency)/i);
});

test('rejects verify payload when receipts is not array', async () => {
  const res = await fetch(`${base}/api/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ receipts: 'not-array' })
  });

  assert.equal(res.status, 400);
  const data = await res.json();
  assert.equal(data.ok, false);
  assert.match(data.error, /array/i);
});

test('rejects non-uuid task id path', async () => {
  const res = await fetch(`${base}/api/tasks/abc123/verify`);
  assert.equal(res.status, 400);

  const data = await res.json();
  assert.equal(data.ok, false);
  assert.match(data.error, /invalid task id format/i);
});
