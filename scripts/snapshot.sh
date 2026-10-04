#!/usr/bin/env bash
# Eksportér datamodellen (collections, felter, relationer, oversættelser) til schema/snapshot.yaml.
# Kør efter hver ændring af datamodellen i Directus, og commit filen.
set -euo pipefail
. "$(dirname "$0")/_common.sh"
docker compose exec -T directus node cli.js schema snapshot --yes --format yaml /tmp/snapshot.yaml >/dev/null
docker compose exec -T directus cat /tmp/snapshot.yaml > schema/snapshot.yaml
echo "schema/snapshot.yaml opdateret ($(wc -l < schema/snapshot.yaml) linjer). Husk: git add schema/snapshot.yaml && git commit"
