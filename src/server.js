import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { runAgentWorkflow } from './agent.js';
import { buildReceipts, verifyReceipts } from './receipts.js';
import { getTask, readDb, saveTask } from './store.js';

const publicDir = path.resolve(process.cwd(), 'public');

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data, null, 2));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
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

export function createAppServer() {
  return http.createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/api/health') {
        return json(res, 200, { ok: true, service: 'proofmesh-agent', ts: new Date().toISOString() });
      }

      if (req.method === 'GET' && req.url === '/api/tasks') {
        const db = readDb();
        const tasks = db.tasks.map((t) => ({
          id: t.id,
          createdAt: t.createdAt,
          title: t.payload?.title || 'Untitled',
          decision: t.result?.decision,
          confidence: t.result?.confidence
        }));
        return json(res, 200, { ok: true, tasks });
      }

      if (req.method === 'POST' && req.url === '/api/verify') {
        const body = await readBody(req);
        return json(res, 200, { ok: true, verification: verifyReceipts(body.receipts || []) });
      }

      if (req.method === 'POST' && req.url === '/api/tasks') {
        const payload = await readBody(req);
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

      const taskMatch = req.url.match(/^\/api\/tasks\/([a-f0-9-]+)$/i);
      if (req.method === 'GET' && taskMatch) {
        const task = getTask(taskMatch[1]);
        if (!task) return json(res, 404, { ok: false, error: 'Task not found' });
        return json(res, 200, { ok: true, task });
      }

      const verifyMatch = req.url.match(/^\/api\/tasks\/([a-f0-9-]+)\/verify$/i);
      if (req.method === 'GET' && verifyMatch) {
        const task = getTask(verifyMatch[1]);
        if (!task) return json(res, 404, { ok: false, error: 'Task not found' });
        return json(res, 200, { ok: true, verification: verifyReceipts(task.receipts) });
      }

      const tamperMatch = req.url.match(/^\/api\/tasks\/([a-f0-9-]+)\/tamper-check$/i);
      if (req.method === 'GET' && tamperMatch) {
        const task = getTask(tamperMatch[1]);
        if (!task) return json(res, 404, { ok: false, error: 'Task not found' });
        const tampered = tamperReceipt(task.receipts);
        return json(res, 200, {
          ok: true,
          original: verifyReceipts(task.receipts),
          tampered: verifyReceipts(tampered)
        });
      }

      const bundleMatch = req.url.match(/^\/api\/tasks\/([a-f0-9-]+)\/judge-bundle$/i);
      if (req.method === 'GET' && bundleMatch) {
        const task = getTask(bundleMatch[1]);
        if (!task) return json(res, 404, { ok: false, error: 'Task not found' });
        return json(res, 200, { ok: true, bundle: buildJudgeBundle(task) });
      }

      if (serveStatic(req, res)) return;

      return json(res, 404, { ok: false, error: 'Not found' });
    } catch (err) {
      return json(res, 500, { ok: false, error: err.message });
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
