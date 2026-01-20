# AICostLedger

A web app plus local collector that scrapes AI billing portals and produces a unified ledger with CSV export.

## What it does
- Local collector reuses a real logged-in Chrome session (no password automation).
- Scrapes invoices/charges for OpenAI, Anthropic, and Cursor.
- Uploads normalized ledger items and PDFs to Firebase.
- Web UI shows the ledger and exports a single CSV.

## Stack
- Web: React (Vite) + TypeScript + Tailwind + shadcn/ui
- Backend: Firebase Functions v2 (Express)
- Data: Firestore + Storage
- Collector: Node CLI + Playwright (persistent profiles) + Cloud Run collector service

## Monorepo layout
- `apps/web` - React frontend
- `apps/functions` - Firebase Functions API
- `apps/collector` - Cloud Run collector service (Playwright)
- `packages/shared` - shared types + zod schemas
- `packages/collector` - local Playwright collector CLI
- `services/api` - legacy Cloud Run API (not used)

## Quick start
### Install dependencies
```bash
pnpm install
```

### Configure Firebase web app
Create `apps/web/.env.local` with Firebase web config:
```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
```

### Deploy
```bash
pnpm -C apps/functions build
pnpm -C apps/web build
firebase deploy --only hosting,functions,firestore:rules,storage
```

### Deploy collector service (Cloud Run)
```bash
pnpm -C packages/shared build
pnpm -C packages/collector build
pnpm -C apps/collector build
gcloud run deploy aicostledger-collector \\
  --source apps/collector \\
  --region us-west1 \\
  --set-env-vars \"AICOSTLEDGER_AI_DIR=/tmp/aicostledger,ALLOWED_EMAILS=you@example.com\" \\
  --allow-unauthenticated
```
After deploy, Firebase Hosting routes `/collector/**` to the service (see `firebase.json`).

## Cloud collector workflow
1) Open the Connectors page and click **Connect** on a provider.
2) Open the login window, complete Google SSO, then click **Save session**.
3) Click **Sync now** to pull invoices for the selected range.

## Collector workflow
1) Generate an ingestion token in the web app (Connectors page).
2) Build and run the collector:
```bash
pnpm -C packages/collector build
pnpm -C packages/collector exec playwright install
node packages/collector/dist/index.js init
node packages/collector/dist/index.js connect openai_chatgpt
node packages/collector/dist/index.js sync openai_chatgpt --from 2024-01 --to 2024-02
```
3) Repeat `connect` and `sync` for other providers, or run:
```bash
node packages/collector/dist/index.js sync:all --from 2024-01 --to 2024-02
```

## Provider IDs
- `openai_chatgpt`
- `openai_api`
- `anthropic_claude`
- `anthropic_api`
- `cursor`
- `manus`

## Troubleshooting
- Session expired: run `aicostledger connect <providerId>` again.
- No invoices: check `.ai/snapshots/<providerId>/` for HTML/screenshots.
- 401 on ingest: rotate the ingestion token in Settings and re-run `init`.

## How to run (checklist)
- `pnpm install`
- Configure `apps/web/.env.local`
- Deploy with Firebase
- Generate ingestion token in UI
- `aicostledger init`
- `aicostledger connect <providerId>`
- `aicostledger sync <providerId>`
- Export CSV from Ledger page
