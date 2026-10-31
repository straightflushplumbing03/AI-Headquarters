#!/usr/bin/env bash
# Build the 3D front end (first run only) and start the headquarters on http://127.0.0.1:8000
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -d web/dist ]; then (cd web && npm ci && npm run build); fi
cd backend
pip install -q -r requirements.txt
exec python3 -m uvicorn hq.main:app --host "${HQ_HOST:-127.0.0.1}" --port "${HQ_PORT:-8000}"
