# Security

## Tokens and secrets
- The ingestion token is generated in the web UI and stored hashed in Firestore at `users/{uid}/secrets/ingestionToken`.
- A lookup document is stored at `ingestionTokens/{sha256(token)}` to resolve the owner.
- Tokens are never logged and are only shown once in the UI.

## Storage
- Receipt PDFs are stored at `receipts/{uid}/{providerId}/{stableId}.pdf` in Firebase Storage.
- Storage rules restrict reads to the authenticated owner; writes are performed server-side.
- Cloud collector browser sessions (storage state JSON) are stored at `collector-sessions/{uid}/{providerId}/storageState.json`.

## Local collector profiles
- Collector sessions are stored locally at `~/.aicostledger/profiles/<providerId>/`.
- These profiles contain cookies; keep the directory private and do not share it.

## Rotation and deletion
- Rotate the ingestion token from the Settings page.
- Delete ledger data and receipts from the Settings page.
- Delete local profiles with `aicostledger logout <providerId>`.
