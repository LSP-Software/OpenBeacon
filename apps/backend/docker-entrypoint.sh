#!/bin/sh
# This shell stays PID 1 and forwards SIGTERM to whichever step is running; the backend then finishes its requests and queued work before exiting.
trap 'kill -TERM "$child" 2>/dev/null; wait "$child"; exit 143' TERM INT

run() {
  "$@" &
  child=$!
  wait "$child"
}

run bun run apps/backend/src/validateEnv.ts || exit
run bun run --cwd packages/database prisma migrate deploy || exit
run bun run apps/backend/src/index.ts
