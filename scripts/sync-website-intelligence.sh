#!/usr/bin/env bash
# Refresh the read-only snapshot of website intelligence material.
#
# Source of truth: github.com/straightflushplumbing03/-Up2datewebsiteseo (the
# live site, straightflushplumbingoc.com). This script only READS that repo:
# it shallow-clones it into a temp dir and copies selected folders here. It
# never commits, pushes or writes anything to the website repository.
#
# Usage: scripts/sync-website-intelligence.sh [git-ref]   (default: main)
set -euo pipefail

REF="${1:-main}"
SRC_URL="https://github.com/straightflushplumbing03/-Up2datewebsiteseo.git"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/website-intelligence"
FOLDERS=(ai-headquarters-blueprint growth-engine briefs)

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
git clone -q --depth 1 --branch "$REF" "$SRC_URL" "$TMP/site"
SHA="$(git -C "$TMP/site" rev-parse HEAD)"
DATE="$(git -C "$TMP/site" log -1 --format=%cs)"

# Refuse to copy anything that looks like a credential.
if grep -rIlE '(AIza[0-9A-Za-z_-]{30,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,}|eyJhbGciOi[A-Za-z0-9_-]{20,}|tvly-[A-Za-z0-9]{20,}|xox[abp]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY)' \
     "${FOLDERS[@]/#/$TMP/site/}" >/dev/null 2>&1; then
  echo "Refusing to sync: possible credential found in source folders." >&2
  exit 3
fi

for f in "${FOLDERS[@]}"; do
  rm -rf "${DEST:?}/$f"
  cp -R "$TMP/site/$f" "$DEST/$f"
done
printf '%s\n' "repository: straightflushplumbing03/-Up2datewebsiteseo" "ref: $REF" "commit: $SHA" "commit_date: $DATE" \
  "synced_at: $(date -u +%Y-%m-%dT%H:%M:%SZ)" "folders: ${FOLDERS[*]}" > "$DEST/SOURCE.txt"
echo "Synced ${FOLDERS[*]} from $SHA ($DATE)"
