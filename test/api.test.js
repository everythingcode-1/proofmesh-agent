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
