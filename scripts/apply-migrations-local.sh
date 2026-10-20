#!/usr/bin/env bash
# Apply the Supabase shim + every migration to a LOCAL scratch Postgres.
# Loops the whole set to a fixpoint because the numeric prefixes do not sort
# into dependency order (see docs/AI-AUTHORITY-ENGINE.md, Gotcha #1).
#
# Usage: DATABASE_URL=postgres://user:pass@localhost/sfi_test scripts/apply-migrations-local.sh
# Refuses to run against anything that is not localhost.
set -uo pipefail

: "${DATABASE_URL:?set DATABASE_URL to a local scratch database}"
case "$DATABASE_URL" in
  *@localhost*|*@127.0.0.1*) ;;
  *) echo "Refusing: DATABASE_URL is not a local database" >&2; exit 2 ;;
esac

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -f "$ROOT/tests/sql/supabase_shim.sql" >/dev/null

prev=-1
for pass in 1 2 3 4 5 6; do
  failed=()
  for f in "$ROOT"/supabase/migrations/*.sql; do
    if ! psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -1 -f "$f" >/dev/null 2>"/tmp/mig_err_$$"; then
      failed+=("$(basename "$f"): $(grep -m1 ERROR "/tmp/mig_err_$$")")
    fi
  done
  echo "pass $pass: ${#failed[@]} file(s) with errors"
  if [ "${#failed[@]}" -eq "$prev" ]; then break; fi
  prev=${#failed[@]}
done

# Supabase grants table privileges to the API roles by default; RLS restricts rows.
psql "$DATABASE_URL" -q -c "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated, service_role; GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;" >/dev/null
# Phase A: re-apply the event-log revokes, which the blanket grant above undoes.
psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1 -c "SELECT workforce_apply_privileges();" >/dev/null 2>&1 || true

printf '%s\n' "${failed[@]}"
rm -f "/tmp/mig_err_$$"
