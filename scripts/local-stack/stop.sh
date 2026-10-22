#!/usr/bin/env bash
HERE="$(cd "$(dirname "$0")" && pwd)"
STATE="${STACK_STATE:-$(cd "$HERE/../.." && pwd)/.local-stack}"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
for s in gateway postgrest storage auth; do
  [[ -f "$STATE/$s.pid" ]] && kill "$(cat "$STATE/$s.pid")" 2>/dev/null; rm -f "$STATE/$s.pid"
done
pkill -f "src/start/server.ts" 2>/dev/null || true
AS_PG=(); [[ $EUID -eq 0 ]] && AS_PG=(runuser -u postgres --)
[[ -d "$STATE/pgdata" ]] && "${AS_PG[@]}" "$PG_BIN/pg_ctl" -D "$STATE/pgdata" -m fast stop >/dev/null 2>&1
echo stopped
