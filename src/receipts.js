import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const keyDir = path.resolve(process.cwd(), 'data', 'keys');
const privateKeyPath = path.join(keyDir, 'ed25519-private.pem');
const publicKeyPath = path.join(keyDir, 'ed25519-public.pem');

function ensureKeys() {
  if (!fs.existsSync(keyDir)) fs.mkdirSync(keyDir, { recursive: true });

  if (!fs.existsSync(privateKeyPath) || !fs.existsSync(publicKeyPath)) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    fs.writeFileSync(privateKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
    fs.writeFileSync(publicKeyPath, publicKey.export({ type: 'spki', format: 'pem' }));
  }

  return {
    privateKey: fs.readFileSync(privateKeyPath, 'utf8'),
    publicKey: fs.readFileSync(publicKeyPath, 'utf8')
  };
}

function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function canonical(obj) {
  return JSON.stringify(obj, Object.keys(obj).sort());
}

export function buildReceipts({ taskId, payload, result }) {
  const { privateKey, publicKey } = ensureKeys();

  const steps = [
    { type: 'ingest', reason: 'Input diterima dan dinormalisasi', data: payload },
    { type: 'score', reason: 'Scoring urgency-impact-budget dihitung', data: result.scoring },
    { type: 'decision', reason: 'Keputusan akhir ditetapkan', data: { decision: result.decision, confidence: result.confidence } },
    { type: 'plan', reason: 'Rencana aksi otomatis dibuat', data: { plan: result.plan } }
  ];

  let prevHash = 'GENESIS';

  return steps.map((s, idx) => {
    const inputHash = sha256(canonical(s.data));
    const core = {
      taskId,
      stepIndex: idx + 1,
      stepType: s.type,
      reason: s.reason,
      inputHash,
      prevHash,
      ts: new Date().toISOString()
    };

    const receiptHash = sha256(canonical(core));
    const signature = crypto.sign(null, Buffer.from(receiptHash, 'utf8'), privateKey).toString('base64');

    const receipt = {
      ...core,
      receiptHash,
      signature,
      publicKey
    };

    prevHash = receiptHash;
    return receipt;
  });
}

export function verifyReceipts(receipts = []) {
  let prevHash = 'GENESIS';

  for (const r of receipts) {
    const core = {
      taskId: r.taskId,
      stepIndex: r.stepIndex,
      stepType: r.stepType,
      reason: r.reason,
      inputHash: r.inputHash,
      prevHash: r.prevHash,
      ts: r.ts
    };

    if (r.prevHash !== prevHash) {
      return { ok: false, reason: `Broken chain at step ${r.stepIndex}` };
    }

    const expectedHash = sha256(canonical(core));
    if (expectedHash !== r.receiptHash) {
      return { ok: false, reason: `Hash mismatch at step ${r.stepIndex}` };
    }

    const sigOk = crypto.verify(
      null,
      Buffer.from(r.receiptHash, 'utf8'),
      r.publicKey,
      Buffer.from(r.signature, 'base64')
    );

    if (!sigOk) {
      return { ok: false, reason: `Signature invalid at step ${r.stepIndex}` };
    }

    prevHash = r.receiptHash;
  }

  return { ok: true, reason: 'All receipts valid', steps: receipts.length };
}
