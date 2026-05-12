#!/bin/bash
set -e
cd "$(dirname "$0")/backend"
exec uvicorn main:app --host 0.0.0.0 --port "${PORT:-8081}" --workers "${WEB_CONCURRENCY:-2}"
