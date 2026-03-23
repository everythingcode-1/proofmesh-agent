import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { runAgentWorkflow } from './agent.js';
import { buildReceipts, verifyReceipts } from './receipts.js';
import { getTask, readDb, saveTask } from './store.js';

const publicDir = path.resolve(process.cwd(), 'public');
const UUID_RE = /^[a-f0-9-]{36}$/i;

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data, null, 2));
}

const MAX_BODY_BYTES = 64 * 1024;

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let receivedBytes = 0;
    let tooLarge = false;

    req.on('data', (chunk) => {
      receivedBytes += chunk.length;
      if (receivedBytes > MAX_BODY_BYTES) {
        tooLarge = true;
        return;
      }
      data += chunk;
    });

    req.on('end', () => {
      if (tooLarge) return reject(new Error('Payload too large'));

      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(new Error('Invalid JSON body'));
      }
    });

    req.on('error', reject);
  });
}

function requiresJson(req) {
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  return contentType.includes('application/json');
}

function serveStatic(req, res) {
  const reqPath = req.url === '/' ? '/index.html' : req.url;
  const filePath = path.join(publicDir, reqPath.split('?')[0]);
  if (!filePath.startsWith(publicDir) || !fs.existsSync(filePath)) return false;

  const ext = path.extname(filePath);
  const contentType = ext === '.html' ? 'text/html' : ext === '.js' ? 'text/javascript' : 'text/css';
  res.writeHead(200, { 'Content-Type': contentType });
  res.end(fs.readFileSync(filePath));
  return true;
}

function buildJudgeBundle(task) {
  const verification = verifyReceipts(task.receipts);
  return {
    project: 'ProofMesh Agent',
    generatedAt: new Date().toISOString(),
    taskId: task.id,
    summary: {
      decision: task.result.decision,
      confidence: task.result.confidence,
      score: task.result.scoring.total,
      totalReceipts: task.receipts.length,
      verification: verification.ok ? 'PASS' : 'FAIL'
    },
    judgingNarrative: {
      problem: 'Agent decisions are hard to audit and trust.',
      solution: 'Each workflow step emits signed cryptographic receipt with hash-chain provenance.',
      whyItMatters: 'Judges and users can independently verify decision integrity.'
    },
    artifacts: {
      payload: task.payload,
      scoring: task.result.scoring,
      decision: task.result.decision,
      plan: task.result.plan,
      receipts: task.receipts,
      verification
    }
  };
}

function tamperReceipt(receipts = []) {
  const cloned = JSON.parse(JSON.stringify(receipts));
  if (cloned[1]) cloned[1].reason = 'tampered-by-demo';
  return cloned;
}

function hashReceiptList(receipts = []) {
  return crypto.createHash('sha256').update(JSON.stringify(receipts)).digest('hex');
}

function buildReplayAudit(task) {
  const timestamps = Array.isArray(task.receipts) ? task.receipts.map((r) => r.ts) : [];
  const regenerated = buildReceipts({ taskId: task.id, payload: task.payload, result: task.result, timestamps });
  const storedHash = hashReceiptList(task.receipts);
  const regeneratedHash = hashReceiptList(regenerated);

  return {
    ok: storedHash === regeneratedHash,
    storedVerification: verifyReceipts(task.receipts),
    regeneratedVerification: verifyReceipts(regenerated),
    storedHash,
    regeneratedHash
  };
}

function validateTaskPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return 'Payload must be a JSON object';
  }

  if (payload.title !== undefined && typeof payload.title !== 'string') {
    return 'title must be a string';
  }

  if (payload.description !== undefined && typeof payload.description !== 'string') {
    return 'description must be a string';
  }

  if (payload.budget !== undefined) {
    const budget = Number(payload.budget);
    if (!Number.isFinite(budget) || budget < 0) return 'budget must be a non-negative number';
  }

  const allowedLevels = new Set(['low', 'medium', 'high']);
  if (payload.urgency !== undefined && !allowedLevels.has(String(payload.urgency).toLowerCase())) {
    return 'urgency must be one of: low, medium, high';
  }

  if (payload.impact !== undefined && !allowedLevels.has(String(payload.impact).toLowerCase())) {
    return 'impact must be one of: low, medium, high';
  }

  return null;
}

function toTaskSummary(task) {
  return {
    id: task.id,
    createdAt: task.createdAt,
    title: task.payload?.title || 'Untitled',
    decision: task.result?.decision,
    confidence: task.result?.confidence
  };
}

function clampLimit(value, fallback = 20) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), 100);
}

function buildStats(tasks) {
  const stats = {
    total: tasks.length,
    decisions: { APPROVE: 0, REVIEW: 0, REJECT: 0 },
    avgConfidence: 0
  };

  if (tasks.length === 0) return stats;

  let confidenceTotal = 0;

  for (const task of tasks) {
    const decision = task?.result?.decision;
    if (decision && stats.decisions[decision] !== undefined) stats.decisions[decision] += 1;
    confidenceTotal += Number(task?.result?.confidence || 0);
  }

  stats.avgConfidence = Number((confidenceTotal / tasks.length).toFixed(3));
  return stats;
}

export function createAppServer() {
  return http.createServer(async (req, res) => {
    try {
      const reqUrl = new URL(req.url, 'http://localhost');

      if (req.method === 'GET' && reqUrl.pathname === '/api/health') {
        return json(res, 200, { ok: true, service: 'proofmesh-agent', ts: new Date().toISOString() });
      }

      if (req.method === 'GET' && reqUrl.pathname === '/api/tasks') {
        const db = readDb();
        const limit = clampLimit(reqUrl.searchParams.get('limit'));
        const tasks = db.tasks.slice(0, limit).map(toTaskSummary);
        return json(res, 200, { ok: true, total: db.tasks.length, limit, tasks });
      }

      if (req.method === 'GET' && reqUrl.pathname === '/api/stats') {
        const db = readDb();
        return json(res, 200, { ok: true, stats: buildStats(db.tasks) });
      }

      if (req.method === 'POST' && reqUrl.pathname === '/api/verify') {
        if (!requiresJson(req)) {
          return json(res, 415, { ok: false, error: 'Content-Type must be application/json' });
        }

        const body = await readBody(req);
        if (!Array.isArray(body.receipts)) {
          return json(res, 400, { ok: false, error: 'receipts must be an array' });
        }
        return json(res, 200, { ok: true, verification: verifyReceipts(body.receipts) });
      }

      if (req.method === 'POST' && reqUrl.pathname === '/api/tasks') {
        if (!requiresJson(req)) {
          return json(res, 415, { ok: false, error: 'Content-Type must be application/json' });
        }

        const payload = await readBody(req);
        const validationError = validateTaskPayload(payload);
        if (validationError) return json(res, 400, { ok: false, error: validationError });

        const result = runAgentWorkflow(payload);
        const id = crypto.randomUUID();
        const receipts = buildReceipts({ taskId: id, payload, result });

        const task = {
          id,
          createdAt: new Date().toISOString(),
          payload,
          result,
          receipts
        };

        saveTask(task);
        return json(res, 201, { ok: true, task });
      }

      const taskMatch = reqUrl.pathname.match(/^\/api\/tasks\/([a-f0-9-]+)$/i);
      if (req.method === 'GET' && taskMatch) {
        if (!UUID_RE.test(taskMatch[1])) return json(res, 400, { ok: false, error: 'Invalid task id format' });
        const task = getTask(taskMatch[1]);
        if (!task) return json(res, 404, { ok: false, error: 'Task not found' });
        return json(res, 200, { ok: true, task });
      }

      const verifyMatch = reqUrl.pathname.match(/^\/api\/tasks\/([a-f0-9-]+)\/verify$/i);
      if (req.method === 'GET' && verifyMatch) {
        if (!UUID_RE.test(verifyMatch[1])) return json(res, 400, { ok: false, error: 'Invalid task id format' });
        const task = getTask(verifyMatch[1]);
        if (!task) return json(res, 404, { ok: false, error: 'Task not found' });
        return json(res, 200, { ok: true, verification: verifyReceipts(task.receipts) });
      }

      const replayMatch = reqUrl.pathname.match(/^\/api\/tasks\/([a-f0-9-]+)\/replay-audit$/i);
      if (req.method === 'GET' && replayMatch) {
        if (!UUID_RE.test(replayMatch[1])) return json(res, 400, { ok: false, error: 'Invalid task id format' });
        const task = getTask(replayMatch[1]);
        if (!task) return json(res, 404, { ok: false, error: 'Task not found' });
        return json(res, 200, { ok: true, audit: buildReplayAudit(task) });
      }

      const tamperMatch = reqUrl.pathname.match(/^\/api\/tasks\/([a-f0-9-]+)\/tamper-check$/i);
      if (req.method === 'GET' && tamperMatch) {
        if (!UUID_RE.test(tamperMatch[1])) return json(res, 400, { ok: false, error: 'Invalid task id format' });
        const task = getTask(tamperMatch[1]);
        if (!task) return json(res, 404, { ok: false, error: 'Task not found' });
        const tampered = tamperReceipt(task.receipts);
        return json(res, 200, {
          ok: true,
          original: verifyReceipts(task.receipts),
          tampered: verifyReceipts(tampered)
        });
      }

      const bundleMatch = reqUrl.pathname.match(/^\/api\/tasks\/([a-f0-9-]+)\/judge-bundle$/i);
      if (req.method === 'GET' && bundleMatch) {
        if (!UUID_RE.test(bundleMatch[1])) return json(res, 400, { ok: false, error: 'Invalid task id format' });
        const task = getTask(bundleMatch[1]);
        if (!task) return json(res, 404, { ok: false, error: 'Task not found' });
        return json(res, 200, { ok: true, bundle: buildJudgeBundle(task) });
      }

      if (serveStatic(req, res)) return;

      return json(res, 404, { ok: false, error: 'Not found' });
    } catch (err) {
      const message = err?.message || 'Internal server error';
      if (message === 'Invalid JSON body') {
        return json(res, 400, { ok: false, error: message });
      }
      if (message === 'Payload too large') {
        return json(res, 413, { ok: false, error: message });
      }
      return json(res, 500, { ok: false, error: message });
    }
  });
}

export function startServer({ port } = {}) {
  const PORT = Number(port || process.env.PROOFMESH_PORT || process.env.PORT || 8787);
  const server = createAppServer();
  server.listen(PORT, () => {
    console.log(`ProofMesh Agent running at http://localhost:${PORT}`);
  });
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer();
}
