import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../src/server.js';

let server;
let base;

test.before(async () => {
  const port = 8989;
  server = startServer({ port });
  base = `http://localhost:${port}`;
  await new Promise((r) => setTimeout(r, 120));
});

test.after(() => {
  server?.close();
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

test('returns stats and supports list limit parameter', async () => {
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

  const listRes = await fetch(`${base}/api/tasks?limit=1`);
  const list = await listRes.json();

  assert.equal(list.ok, true);
  assert.equal(list.limit, 1);
  assert.equal(list.tasks.length, 1);
  assert.ok(list.total >= 2);

  const statsRes = await fetch(`${base}/api/stats`);
  const stats = await statsRes.json();

  assert.equal(stats.ok, true);
  assert.ok(stats.stats.total >= 2);
  assert.ok(Number.isFinite(stats.stats.avgConfidence));
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
