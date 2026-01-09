# Sovereign Jedi — Environment & prerequisites

This repository contains the web UI (Next.js) demo for "Episode I: The awakening (MVP)".  
The provided `./dev.sh` script offers a one-command developer flow to start the web UI and (optionally) a local IPFS node via Docker.

---

## Recommended versions
- Node.js: >= 18.x (tested on 18.x)
- pnpm: 8.9.0

---

## Prerequisites
- Git
- Node.js (>=18) and pnpm
- curl or wget (used by the health checks in `dev.sh`)
- Docker & Docker Compose (required only if you use `./dev.sh --with-ipfs`)

---

## Ports used
- Next.js dev server: http://localhost:1620
- IPFS HTTP API (when running via docker compose): http://127.0.0.1:5001/api/v0

The web UI is a Scope‑2 mock: IPFS is optional and the UI will start even if IPFS is not available.

---

## One-command usage
- Start web dev server (IPFS optional):
  - ./dev.sh

- Start IPFS via Docker Compose, wait for IPFS to be ready, then start web dev server:
  - ./dev.sh --with-ipfs

Behavior:
- `./dev.sh` will:
  - run `pnpm install` at repo root,
  - start the Next.js dev server for `apps/web`,
  - perform an HTTP health check at `http://localhost:3000`,
  - if IPFS is not reachable, print a WARNING but continue (UI mock still runs).

- `./dev.sh --with-ipfs` will:
  - start the IPFS compose located at `infra/ipfs/docker-compose.yml` (detached),
  - wait for the IPFS HTTP API to respond at `http://127.0.0.1:5001/api/v0/version` (timeout),
  - if IPFS does not become healthy within the timeout the script will fail with logs to help diagnose,
  - on IPFS success it will then start the web dev server and perform the web health check.

On successful web startup the script will print exactly:
```
✅ Dev server is up and healthy at: http://localhost:1620
```

---

## Helpful commands
- Start IPFS manually (if needed):
  - cd infra/ipfs
  - docker compose up -d

- Stop IPFS:
  - docker compose -f infra/ipfs/docker-compose.yml down

- Check IPFS API:
  - curl -sSf http://127.0.0.1:5001/api/v0/version

- Tail web logs:
  - tail -f dev-web.log

---

## Troubleshooting
- If `pnpm` is not found, the script attempts to enable it via Corepack. If Corepack is not available, install pnpm manually: https://pnpm.io/installation
- If the web server does not come up:
  - inspect `dev-web.log` for errors:
    - tail -n 200 dev-web.log
  - ensure required ports are free: `lsof -i :3000` (or equivalent)
- If `./dev.sh --with-ipfs` fails during IPFS startup:
  - check Docker containers: `docker ps | grep ipfs`
  - show IPFS container logs: `docker compose -f infra/ipfs/docker-compose.yml logs --tail=200`

---

## Notes
- Scope: UI mock only. The web UI intentionally does not require IPFS to start; IPFS is only for integration/testing when requested.
- The script writes web server logs to `dev-web.log` at the repository root.
- The script prints the exact success line above when the web server healthcheck passes; that line is used by the DoD for successful startup.