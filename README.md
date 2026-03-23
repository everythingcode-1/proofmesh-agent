# ProofMesh Agent

Autonomous workflow agent with cryptographic receipts for every decision step.

## MVP Features
- Submit task and run autonomous decision workflow
- Append-only receipt chain (`prevHash`, `receiptHash`)
- Receipt signing (Ed25519)
- Verification endpoint (integrity + signature)
- Minimal web UI for demo

## Run
```bash
cd proofmesh-agent
npm run start
```
Open: http://localhost:8787

## API
- `POST /api/tasks` create + execute task
- `GET /api/tasks/:id` fetch task detail
- `GET /api/tasks/:id/verify` verify receipt chain
- `GET /api/health` health check

## Notes
This is day-1 MVP foundation for hackathon delivery in 3 days.
