# NextLevelApex GUI (Phase 1 Scaffold)

This directory contains a Tauri-ready frontend scaffold for a local-only GUI.

## What is included
- 3-screen IA scaffold (`Dashboard`, `Tasks`, `Details`)
- Safe NLX command bridge contract (allowlist + timeout + redaction)
- Diagnose parser + status mapping
- Unit tests for parser, redaction, and allowlist behavior

## Security guardrails
- No shell interpolation
- Strict allowlisted command IDs only
- Redaction of obvious secrets before display
- Non-mutating command scope for v1

## Local run (frontend scaffold)
```bash
cd apps/gui
npm install
npm run dev
```

The current scaffold defaults to a demo runner. In the next phase, this runner contract will be bound to a Tauri command handler that executes the allowlisted `nlx` commands.

## Test
```bash
cd apps/gui
npm test
```
