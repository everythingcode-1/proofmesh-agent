# ProofMesh Agent

Autonomous workflow agent with cryptographic receipts for every decision step.

## Current Status
Day-2 MVP in progress (3-day delivery plan).

## Features
- Submit task and run autonomous decision workflow
- Append-only receipt chain (`prevHash`, `receiptHash`)
- Receipt signing (Ed25519)
- Verification endpoint (integrity + signature)
- Tamper simulation endpoint for demo
- Judge bundle export endpoint
- Minimal web UI with receipt timeline + verification badge

## Run
```bash
cd proofmesh-agent
npm run start
```
Open: http://localhost:8787

## Dev
```bash
npm run dev
```

## Test
```bash
npm test
```

## API
- `GET /api/health` health check
- `GET /api/tasks` list recent tasks
- `POST /api/tasks` create + execute task
- `GET /api/tasks/:id` task detail
- `GET /api/tasks/:id/verify` verify receipt chain
- `GET /api/tasks/:id/tamper-check` compare original vs tampered verification
- `GET /api/tasks/:id/judge-bundle` export submission-ready JSON bundle
- `POST /api/verify` verify any receipt array (custom payload)

## Architecture (MVP)
1. Input payload masuk ke workflow engine (`src/agent.js`)
2. Hasil scoring/decision diproses menjadi receipt chain (`src/receipts.js`)
3. Task + receipts disimpan lokal (`src/store.js`)
4. Verifier memvalidasi hash chain + signature (`verifyReceipts`)
5. UI menampilkan timeline dan status audit (`public/index.html`)
