#!/usr/bin/env bash
# Start a local Supabase-compatible stack for development and tests, built from
# the open-source Supabase services without Docker:
#   Postgres 15+  (PG_BIN, port 54322)    GoTrue auth (AUTH_BIN, :9999)
#   PostgREST     (POSTGREST_BIN, :3000)  Storage API (STORAGE_SRC, :5000)
#   gateway.mjs   (:54321, mimics the Supabase API URL)
# With --reset the database is wiped and every migration is applied from scratch.
# If Docker is available, `supabase start` from the Supabase CLI is the simpler option.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
STATE="${STACK_STATE:-$ROOT/.local-stack}"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
PGDATA="$STATE/pgdata"
SECRET="${JWT_SECRET:-super-secret-jwt-token-with-at-least-32-characters-long}"
: "${AUTH_BIN:?Set AUTH_BIN to the supabase/auth (GoTrue) binary}"
: "${POSTGREST_BIN:?Set POSTGREST_BIN to the PostgREST binary}"
: "${STORAGE_SRC:?Set STORAGE_SRC to a built checkout of supabase/storage}"
mkdir -p "$STATE/storage-data"
PSQL="psql -h /tmp -p 54322 -U postgres -v ON_ERROR_STOP=1 -q"
# Postgres refuses to run as root; use the postgres OS user when needed.
AS_PG=()
if [[ $EUID -eq 0 ]]; then AS_PG=(runuser -u postgres --); fi

"$HERE/stop.sh" >/dev/null 2>&1 || true

if [[ "${1:-}" == "--reset" ]]; then rm -rf "$PGDATA"; fi
if [[ ! -d "$PGDATA" ]]; then
  mkdir -p "$PGDATA"
  [[ $EUID -eq 0 ]] && chown -R postgres "$PGDATA" && chmod 755 "$STATE"
  "${AS_PG[@]}" "$PG_BIN/initdb" -D "$PGDATA" -U postgres --auth=trust >/dev/null
  FRESH=1
fi
touch "$STATE/postgres.log"; [[ $EUID -eq 0 ]] && chown postgres "$STATE/postgres.log"
"${AS_PG[@]}" "$PG_BIN/pg_ctl" -D "$PGDATA" -o "-p 54322 -k /tmp" -l "$STATE/postgres.log" -w start >/dev/null
$PSQL -f "$HERE/roles.sql"

ANON=$(node "$HERE/jwt.mjs" "$SECRET" anon)
SERVICE=$(node "$HERE/jwt.mjs" "$SECRET" service_role)
printf 'SUPABASE_URL=http://localhost:54321\nSUPABASE_ANON_KEY=%s\nSUPABASE_SERVICE_ROLE_KEY=%s\n' "$ANON" "$SERVICE" > "$STATE/keys.env"

env GOTRUE_DB_DRIVER=postgres DATABASE_URL="postgres://supabase_auth_admin:postgres@127.0.0.1:54322/postgres?sslmode=disable" \
  GOTRUE_DB_NAMESPACE=auth GOTRUE_JWT_SECRET="$SECRET" GOTRUE_JWT_EXP=3600 GOTRUE_JWT_AUD=authenticated \
  GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated GOTRUE_JWT_ADMIN_ROLES=service_role GOTRUE_SITE_URL=http://localhost:5173 \
  API_EXTERNAL_URL=http://localhost:54321/auth/v1 GOTRUE_API_HOST=127.0.0.1 PORT=9999 GOTRUE_EXTERNAL_EMAIL_ENABLED=true \
  GOTRUE_MAILER_AUTOCONFIRM=true GOTRUE_DISABLE_SIGNUP=false GOTRUE_URI_ALLOW_LIST="http://localhost:*/**" \
  GOTRUE_SMTP_HOST=127.0.0.1 GOTRUE_SMTP_PORT=2500 GOTRUE_SMTP_ADMIN_EMAIL=admin@local.test \
  nohup "$AUTH_BIN" > "$STATE/auth.log" 2>&1 &
echo $! > "$STATE/auth.pid"

env SERVER_HOST=127.0.0.1 SERVER_PORT=5000 SERVER_ADMIN_PORT=5001 SERVER_REGION=local AUTH_JWT_SECRET="$SECRET" \
  AUTH_JWT_ALGORITHM=HS256 ANON_KEY="$ANON" SERVICE_KEY="$SERVICE" \
  DATABASE_URL="postgresql://supabase_storage_admin:postgres@127.0.0.1:54322/postgres" DB_INSTALL_ROLES=false \
  DB_ANON_ROLE=anon DB_SERVICE_ROLE=service_role DB_AUTHENTICATED_ROLE=authenticated DB_SUPER_USER=postgres \
  STORAGE_BACKEND=file STORAGE_FILE_BACKEND_PATH="$STATE/storage-data" FILE_STORAGE_BACKEND_PATH="$STATE/storage-data" \
  TENANT_ID=stub REGION=local GLOBAL_S3_BUCKET=stub UPLOAD_FILE_SIZE_LIMIT=524288000 UPLOAD_FILE_SIZE_LIMIT_STANDARD=524288000 \
  IMAGE_TRANSFORMATION_ENABLED=false STORAGE_LIFECYCLE_ENABLED=false PG_QUEUE_ENABLE=false \
  nohup bash -c "cd '$STORAGE_SRC' && exec ./node_modules/.bin/tsx src/start/server.ts" > "$STATE/storage.log" 2>&1 &
echo $! > "$STATE/storage.pid"

for i in $(seq 1 60); do
  if curl -sf http://127.0.0.1:9999/health >/dev/null && curl -sf http://127.0.0.1:5000/status >/dev/null; then break; fi
  sleep 1
done
curl -sf http://127.0.0.1:9999/health >/dev/null || { echo "auth failed to start, see $STATE/auth.log"; exit 1; }
curl -sf http://127.0.0.1:5000/status >/dev/null || { echo "storage failed to start, see $STATE/storage.log"; exit 1; }

if [[ "${FRESH:-0}" == "1" ]]; then
  for f in "$ROOT"/supabase/migrations/*.sql; do echo "applying $(basename "$f")"; $PSQL -f "$f"; done
fi

env PGRST_DB_URI="postgres://authenticator:postgres@127.0.0.1:54322/postgres" PGRST_DB_SCHEMAS=public \
  PGRST_DB_ANON_ROLE=anon PGRST_JWT_SECRET="$SECRET" PGRST_SERVER_PORT=3000 PGRST_SERVER_HOST=127.0.0.1 \
  nohup "$POSTGREST_BIN" > "$STATE/postgrest.log" 2>&1 &
echo $! > "$STATE/postgrest.pid"
nohup node "$HERE/gateway.mjs" > "$STATE/gateway.log" 2>&1 &
echo $! > "$STATE/gateway.pid"
sleep 2
curl -sf http://localhost:54321/auth/v1/health >/dev/null && echo "Local stack ready at http://localhost:54321 (keys in $STATE/keys.env)"
