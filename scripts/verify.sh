#!/usr/bin/env bash
# Kører den automatiske test af roller, grad-filtrering og fil-beskyttelse (kræver --seed-data).
set -euo pipefail
. "$(dirname "$0")/_common.sh"
docker compose run --rm -T tools verify-access.mjs
