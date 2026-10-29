#!/bin/sh
# Local development entrypoint: install, start Vite, then warm the cold
# module graph before declaring readiness. The first SSR transform inside a
# container can exceed Bun.serve's default 10 second request timeout and
# answer 500 once; pre-warming turns that into fast first loads.
# Bound the warmup: if Vite never becomes ready, keep the server running so
# logs remain inspectable instead of restart-looping.
set -eu

bun install --frozen-lockfile

bun run dev --host 0.0.0.0 --port 3000 &
server_pid=$!

ready=0
attempt=0
while [ "$attempt" -lt 90 ]; do
  attempt=$((attempt + 1))
  if bun -e 'try { const response = await fetch("http://127.0.0.1:3000/"); if (response.ok) { process.exit(0); } } catch { /* not ready yet */ } process.exit(1);' >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done

if [ "$ready" -ne 1 ]; then
  echo "dev server did not answer 200 in time; leaving it running for inspection" >&2
fi

wait "$server_pid"
