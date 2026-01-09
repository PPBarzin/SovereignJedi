#!/usr/bin/env bash
# dev.sh — one-command dev runner for SovereignJedi (apps/web)
#
# Modes:
#   ./dev.sh               -> start web dev, do web healthcheck; if IPFS unavailable show WARNING and continue
#   ./dev.sh --with-ipfs   -> start infra/ipfs/docker-compose.yml, wait for IPFS health, then start web dev and do web healthcheck
#
# Behavior:
# - verifies Node >= 18 and pnpm (tries corepack prepare if missing)
# - runs `pnpm install` at repo root
# - in --with-ipfs mode: ensures Docker available, runs docker compose up -d for infra/ipfs and waits for IPFS HTTP API
# - starts Next.js dev server via `pnpm -C apps/web dev`, waits for web health check
# - prints EXACTLY: "✅ Dev server is up and healthy at: http://localhost:3000" on success
# - tails the web server log until interrupted
#
# Notes:
# - This script is intended to be run from repository root (where this file lives).
# - The script does NOT change UI code or integrate IPFS into UI. It only starts infra when requested.
# - The script writes logs to dev-web.log in the repository root.

set -euo pipefail

# Config
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="${REPO_ROOT}/apps/web"
DEV_LOG="${REPO_ROOT}/dev-web.log"
WEB_URL="http://localhost:6969"
WEB_PORT=6969
IPFS_API="http://127.0.0.1:5001/api/v0"
IPFS_VERSION_ENDPOINT="${IPFS_API}/version"
IPFS_COMPOSE_FILE="${REPO_ROOT}/infra/ipfs/docker-compose.yml"
IPFS_WAIT_SECONDS=60
WEB_WAIT_SECONDS=60
HEALTH_INTERVAL=2
REQUIRED_NODE_MAJOR=18
RECOMMENDED_PNPM_VERSION="8.9.0"

# simple output helpers
info() { printf '\033[1;34m[INFO]\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m[ OK ]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[WARN]\033[0m %s\n' "$*"; }
err()  { printf '\033[1;31m[ERR]\033[0m %s\n' "$*"; }

die() {
  err "$*"
  exit 1
}

# simple semver compare for >= target (major.minor.patch)
ver_ge() {
  local a=${1#v} b=${2#v}
  IFS=. read -r a1 a2 a3 <<<"$a"
  IFS=. read -r b1 b2 b3 <<<"$b"
  a2=${a2:-0}; a3=${a3:-0}
  b2=${b2:-0}; b3=${b3:-0}
  if ((10#$a1 > 10#$b1)); then return 0; fi
  if ((10#$a1 < 10#$b1)); then return 1; fi
  if ((10#$a2 > 10#$b2)); then return 0; fi
  if ((10#$a2 < 10#$b2)); then return 1; fi
  if ((10#$a3 >= 10#$b3)); then return 0; else return 1; fi
}

# Parse args
MODE_WITH_IPFS=0
if [ "${1:-}" = "--with-ipfs" ]; then
  MODE_WITH_IPFS=1
fi

cd "$REPO_ROOT" || die "cannot cd to repo root"

# Check Node
if ! command -v node >/dev/null 2>&1; then
  die "Node.js not found. Install Node >= ${REQUIRED_NODE_MAJOR}.x"
fi
NODE_V_RAW="$(node -v 2>/dev/null || echo "v0.0.0")"
NODE_V="${NODE_V_RAW#v}"
NODE_MAJOR="${NODE_V%%.*}"
if (( NODE_MAJOR < REQUIRED_NODE_MAJOR )); then
  die "Node version ${NODE_V_RAW} detected — require Node >= ${REQUIRED_NODE_MAJOR}.x"
fi
ok "Node ${NODE_V_RAW} detected"

# Ensure pnpm, try corepack if missing
PNPM_CMD=""
if command -v pnpm >/dev/null 2>&1; then
  PNPM_CMD="$(command -v pnpm)"
  PNPM_V="$(pnpm -v 2>/dev/null || echo "0.0.0")"
  ok "pnpm ${PNPM_V} detected at ${PNPM_CMD}"
else
  if command -v corepack >/dev/null 2>&1; then
    info "pnpm not found — enabling via corepack (recommended ${RECOMMENDED_PNPM_VERSION})..."
    set +e
    corepack enable >/dev/null 2>&1 || true
    corepack prepare "pnpm@${RECOMMENDED_PNPM_VERSION}" --activate >/dev/null 2>&1 || true
    set -e
    if command -v pnpm >/dev/null 2>&1; then
      PNPM_CMD="$(command -v pnpm)"
      PNPM_V="$(pnpm -v 2>/dev/null || echo "0.0.0")"
      ok "pnpm ${PNPM_V} enabled via corepack"
    else
      die "pnpm not available after attempting corepack. Install pnpm ${RECOMMENDED_PNPM_VERSION} manually."
    fi
  else
    die "pnpm not installed and corepack not available. Install pnpm ${RECOMMENDED_PNPM_VERSION}."
  fi
fi

# Run install
info "Running pnpm install (repo root)..."
pnpm install --ignore-scripts || die "pnpm install failed"

# If --with-ipfs: ensure docker, start compose, wait for IPFS
if [ "$MODE_WITH_IPFS" -eq 1 ]; then
  info "Mode: --with-ipfs -> will start IPFS infra and wait for API"
  if ! command -v docker >/dev/null 2>&1; then
    die "Docker not found; required for --with-ipfs mode"
  fi
  if ! command -v docker-compose >/dev/null 2>&1 && ! docker compose version >/dev/null 2>&1; then
    warn "docker-compose CLI not found; attempting 'docker compose' (Docker CLI)."
  fi

  if [ ! -f "$IPFS_COMPOSE_FILE" ]; then
    die "IPFS docker-compose file not found at ${IPFS_COMPOSE_FILE}"
  fi

  info "Starting IPFS via docker compose: ${IPFS_COMPOSE_FILE}"
  # prefer 'docker compose' if available, otherwise 'docker-compose'
  if docker compose version >/dev/null 2>&1; then
    docker compose -f "$IPFS_COMPOSE_FILE" up -d || die "docker compose up failed"
  else
    docker-compose -f "$IPFS_COMPOSE_FILE" up -d || die "docker-compose up failed"
  fi

  info "Waiting up to ${IPFS_WAIT_SECONDS}s for IPFS API ${IPFS_API} ..."
  COUNT=0
  IPFS_OK=0
  while [ "$COUNT" -lt "$IPFS_WAIT_SECONDS" ]; do
    if command -v curl >/dev/null 2>&1; then
      if curl -sSf --max-time 3 "${IPFS_API}/version" >/dev/null 2>&1; then
        IPFS_OK=1
        break
      fi
    else
      # if curl missing, try wget
      if command -v wget >/dev/null 2>&1; then
        if wget -q -T 3 -O /dev/null "${IPFS_API}/version" >/dev/null 2>&1; then
          IPFS_OK=1
          break
        fi
      else
        warn "Neither curl nor wget found; cannot healthcheck IPFS. Assuming it will work and continuing."
        IPFS_OK=1
        break
      fi
    fi
    sleep 1
    COUNT=$((COUNT+1))
  done

  if [ "$IPFS_OK" -ne 1 ]; then
    # In --with-ipfs mode we must fail if IPFS didn't come up
    err "IPFS did not respond within ${IPFS_WAIT_SECONDS}s at ${IPFS_API}"
    err "Check Docker containers: docker ps | grep ipfs"
    # show last few docker logs for IPFS service to help debugging (best-effort)
    if docker compose version >/dev/null 2>&1; then
      warn "Dumping last 50 lines of docker compose logs for IPFS (best-effort):"
      docker compose -f "$IPFS_COMPOSE_FILE" logs --no-color --tail=50 || true
    else
      warn "Dumping last 50 lines of docker-compose logs for IPFS (best-effort):"
      docker-compose -f "$IPFS_COMPOSE_FILE" logs --no-color --tail=50 || true
    fi
    die "IPFS healthcheck failed"
  fi
  ok "IPFS API is responding at ${IPFS_API}"
else
  # Check if IPFS is present; if not warn but continue
  IPFS_PRESENT=0
  if command -v curl >/dev/null 2>&1; then
    if curl -sSf --max-time 2 "${IPFS_API}/version" >/dev/null 2>&1; then
      IPFS_PRESENT=1
    fi
  fi
  if [ "$IPFS_PRESENT" -ne 1 ]; then
    warn "IPFS API not available at ${IPFS_API}. UI startup will continue in mock mode."
  else
    ok "IPFS API available at ${IPFS_API}"
  fi
fi

# Start web dev server
info "Starting web dev server (apps/web). Logs -> ${DEV_LOG}"
# remove old log if exists
if [ -f "$DEV_LOG" ]; then
  rm -f "$DEV_LOG" || true
fi

# Start server in background
pnpm -C "$WEB_DIR" dev > "$DEV_LOG" 2>&1 &
WEB_PID=$!
info "Web PID: ${WEB_PID}"

# Setup cleanup trap to kill web server on exit
cleanup() {
  rc=$?
  info "Cleaning up..."
  if ps -p "${WEB_PID}" >/dev/null 2>&1; then
    info "Killing web server (pid ${WEB_PID})..."
    kill "${WEB_PID}" >/dev/null 2>&1 || true
    sleep 1
    if ps -p "${WEB_PID}" >/dev/null 2>&1; then
      warn "Web server did not exit; sending SIGKILL"
      kill -9 "${WEB_PID}" >/dev/null 2>&1 || true
    fi
  fi
  exit ${rc}
}
trap cleanup INT TERM EXIT

# Wait for web health
info "Waiting up to ${WEB_WAIT_SECONDS}s for ${WEB_URL} to respond..."
COUNT=0
WEB_OK=0
while [ "$COUNT" -lt "$WEB_WAIT_SECONDS" ]; do
  # if web process died, fail early
  if ! ps -p "${WEB_PID}" >/dev/null 2>&1; then
    err "Web dev process (pid ${WEB_PID}) exited prematurely. See ${DEV_LOG} for details."
    if [ -f "${DEV_LOG}" ]; then
      err "Last 200 lines of ${DEV_LOG}:"
      tail -n 200 "${DEV_LOG}" >&2 || true
    fi
    exit 1
  fi

  if command -v curl >/dev/null 2>&1; then
    if curl -sSf --max-time 2 "${WEB_URL}" >/dev/null 2>&1; then
      WEB_OK=1
      break
    fi
  else
    # fallback to nc if available
    if command -v nc >/dev/null 2>&1; then
      if nc -z localhost "${WEB_PORT}" >/dev/null 2>&1; then
        WEB_OK=1
        break
      fi
    fi
  fi

  sleep "$HEALTH_INTERVAL"
  COUNT=$((COUNT+1))
done

if [ "$WEB_OK" -ne 1 ]; then
  err "Web server did not respond within ${WEB_WAIT_SECONDS}s at ${WEB_URL}"
  if [ -f "${DEV_LOG}" ]; then
    err "Tail of ${DEV_LOG}:"
    tail -n 200 "${DEV_LOG}" >&2 || true
  fi
  die "Web healthcheck failed"
fi

# Success: print the exact required message, then tail logs
# If IPFS is not available, explicitly notify the user that we are running in mock mode
if [ "${MODE_WITH_IPFS:-0}" -eq 1 ]; then
  if [ "${IPFS_OK:-0}" -ne 1 ]; then
    printf '⚠️ IPFS unavailable — running in mock mode\n\n'
  fi
else
  if [ "${IPFS_PRESENT:-0}" -ne 1 ]; then
    printf '⚠️ IPFS unavailable — running in mock mode\n\n'
  fi
fi

printf '\n'
printf '✅ Dev server is up and healthy at: http://localhost:6969\n'
printf '\n'

# Tail logs (until interrupted). We run tail in foreground so script stays alive and logs visible.
if command -v tail >/dev/null 2>&1; then
  tail -n +1 -f "${DEV_LOG}"
else
  info "tail not available; sleeping while web PID ${WEB_PID} runs"
  wait "${WEB_PID}"
fi

# cleanup will run on EXIT
exit 0
