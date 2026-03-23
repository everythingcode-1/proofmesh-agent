import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { runAgentWorkflow } from './agent.js';
import { buildReceipts, verifyReceipts } from './receipts.js';
import { getTask, saveTask } from './store.js';

const PORT = Number(process.env.PROOFMESH_PORT || process.env.PORT || 8787);
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
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (e) { reject(e); }
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

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/api/health') {
      return json(res, 200, { ok: true, service: 'proofmesh-agent', ts: new Date().toISOString() });
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

    if (serveStatic(req, res)) return;

    return json(res, 404, { ok: false, error: 'Not found' });
  } catch (err) {
    return json(res, 500, { ok: false, error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`ProofMesh Agent running at http://localhost:${PORT}`);
});
