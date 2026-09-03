# Jarvis Command

A Hermes-native browser/PWA command environment for Neal and Jarvis.

The project is intentionally private. Product decisions and durable architecture live in the canonical Obsidian note `05 Coding Projects/Jarvis Command/Jarvis Command.md`.

## Workspace

- `apps/web` — React/Vite command interface
- `apps/server` — Fastify BFF and authorization boundary
- `packages/contracts` — shared validated wire contracts
- `docs/plans` — executable implementation plans

## Commands

```bash
npm install
npm test
npm run typecheck
npm run lint
npm run build
npm run dev
```

No browser-facing code receives Hermes or Cloudflare credentials. The server exposes narrow operations and connects to the official Hermes API through a restricted private transport.
