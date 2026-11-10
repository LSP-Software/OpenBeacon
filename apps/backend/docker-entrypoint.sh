#!/bin/sh
# Bun ignores SIGTERM as PID 1 because the backend registers no handler, so this shell stays PID 1 and forwards the signal to whichever step is running.
trap 'kill -TERM "$child" 2>/dev/null; wait "$child"; exit 143' TERM INT

run() {
  "$@" &
  child=$!
  wait "$child"
}

run bun run apps/backend/src/validateEnv.ts || exit
run bun run --cwd packages/database prisma migrate deploy || exit
run bun run apps/backend/src/index.ts
