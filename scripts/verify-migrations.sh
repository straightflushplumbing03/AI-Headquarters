#!/usr/bin/env bash
# Verify the migration set applies cleanly to a FRESH database and converges.
#
# The numeric prefixes do not sort into dependency order (docs/AI-AUTHORITY-ENGINE.md
# Gotcha #1), so migrations are applied in a loop until the error count stops
# decreasing. A correct set reaches 0 errors. This also asserts the post-fixpoint
# schema satisfies the contracts the application's RPCs depend on, because a
# migration set that "applies" but produces the wrong shape is still broken.
#
# Usage: DATABASE_URL=postgres://user:pass@localhost/db scripts/verify-migrations.sh
# Refuses to run against anything that is not localhost.
set -uo pipefail

: "${DATABASE_URL:?set DATABASE_URL to a local scratch database}"
case "$DATABASE_URL" in
  *@localhost*|*@127.0.0.1*) ;;
  *) echo "Refusing: DATABASE_URL is not a local database" >&2; exit 2 ;;
esac

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PSQL=(psql "$DATABASE_URL" -q -v ON_ERROR_STOP=1)

"${PSQL[@]}" -f "$ROOT/tests/sql/supabase_shim.sql" >/dev/null

prev=-1
for pass in 1 2 3 4 5 6; do
  failed=0
  for f in "$ROOT"/supabase/migrations/*.sql; do
    if ! "${PSQL[@]}" -1 -f "$f" >/dev/null 2>/tmp/verify_mig_err; then
      failed=$((failed + 1))
      if [ "$pass" -eq 1 ]; then
        echo "   $(basename "$f"): $(grep -m1 ERROR /tmp/verify_mig_err)"
      fi
    fi
  done
  echo "pass $pass: $failed file(s) with errors"
  if [ "$failed" -eq "$prev" ]; then break; fi
  prev=$failed
done
rm -f /tmp/verify_mig_err

if [ "$failed" -ne 0 ]; then
  echo "FAIL: migration set did not converge (stuck at $failed error(s))." >&2
  exit 1
fi

# --- schema contract assertions -------------------------------------------
assert() { # assert <description> <sql-that-returns-true>
  local got
  got=$(psql "$DATABASE_URL" -tAc "$2")
  if [ "$got" != "t" ]; then
    echo "FAIL: $1 (got: $got)" >&2
    exit 1
  fi
  echo "ok: $1"
}

assert "budget_reservations.reserved_amount exists" \
  "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='budget_reservations' AND column_name='reserved_amount')"
assert "budget_reservations.settled_amount exists" \
  "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='budget_reservations' AND column_name='settled_amount')"
assert "budget_reservations.status uses the reserved/settled/released vocabulary" \
  "SELECT pg_get_constraintdef(oid) LIKE '%reserved%settled%released%' FROM pg_constraint WHERE conrelid='public.budget_reservations'::regclass AND conname='budget_reservations_status_check'"
assert "reserve_budget_idempotent RPC exists" \
  "SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='reserve_budget_idempotent')"
assert "settle_budget_clamped RPC exists" \
  "SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='settle_budget_clamped')"

echo "PASS: migrations converge to a clean fixpoint and satisfy the app RPC contracts."
