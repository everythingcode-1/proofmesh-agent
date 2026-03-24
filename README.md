# ProofMesh Agent

Autonomous workflow agent with cryptographic receipts for every decision step.

## Current Status
Day-2 MVP in progress (3-day delivery plan).

## Features
- Submit task and run autonomous decision workflow
- Input validation with explicit `400` errors for invalid payloads
- Request hardening: JSON content-type enforcement (`415`) and payload-size guard (`413`, max 64KB)
- Append-only receipt chain (`prevHash`, `receiptHash`)
- Receipt signing (Ed25519)
- Strict verification endpoint (integrity + signature + exact step contract + single-key consistency checks)
- Tamper simulation endpoint for demo
- Judge bundle export endpoint
- Clean routed web UI: landing route (`/`) + operational dashboard route (`/app`) with receipt timeline, replay-audit action, fleet stats, and pagination

## Run
```bash
cd proofmesh-agent
npm run start
```
Open:
- Landing: http://localhost:8787/
- App dashboard: http://localhost:8787/app

## Dev
```bash
npm run dev
```

## Config
- `PROOFMESH_DATA_DIR` (optional): override storage/key directory for tasks.json + Ed25519 keys.
  - Useful for isolated CI tests or multi-instance deployments.

## Test
```bash
npm test
```

## API
- `GET /api/health` health check
- `GET /api/tasks?limit=20&offset=0` list recent tasks (default 20, max 100) with pagination metadata (`total`, `hasMore`)
- `GET /api/stats` ringkasan decision distribution + average confidence + confidence bands + 24h activity
- `POST /api/tasks` create + execute task
- `GET /api/tasks/:id` task detail
- `GET /api/tasks/:id/verify` verify receipt chain
- `GET /api/tasks/:id/replay-audit` regenerate receipts from persisted payload/result and compare hash parity (determinism audit)
- `GET /api/tasks/:id/tamper-check` compare original vs tampered verification
- `GET /api/tasks/:id/judge-bundle` export submission-ready JSON bundle
- `POST /api/verify` verify any receipt array (custom payload)

## Architecture (MVP)
1. Input payload masuk ke workflow engine (`src/agent.js`)
2. Hasil scoring/decision diproses menjadi receipt chain (`src/receipts.js`)
3. Task + receipts disimpan lokal (`src/store.js`)
4. Verifier memvalidasi hash chain + signature (`verifyReceipts`)
5. Landing page ada di `public/index.html`, dan dashboard operasional ada di `public/app.html`
