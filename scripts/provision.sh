#!/usr/bin/env bash
# Sætter en tom Directus op: datamodel fra schema/snapshot.yaml + indstillinger, roller og rettigheder.
# Idempotent - kan køres igen.
#   ./scripts/provision.sh           datamodel + roller (brug dette på den rigtige server)
#   ./scripts/provision.sh --seed    + testbrugere og testposter (kun PoC)
set -euo pipefail
. "$(dirname "$0")/_common.sh"
[ -s schema/snapshot.yaml ] || { echo "schema/snapshot.yaml mangler eller er tom." >&2; exit 1; }

docker compose up -d --wait
echo "1/3 Datamodel (schema apply) ..."
docker compose exec -T directus node cli.js schema apply --yes /directus/schema/snapshot.yaml
echo "2/3 Indstillinger, roller og rettigheder ..."
docker compose run --rm -T tools configure.mjs
if [ "${1:-}" = "--seed" ]; then
  echo "3/3 Testbrugere og testposter ..."
  docker compose run --rm -T tools seed.mjs
else
  echo "3/3 (springer testdata over - brug --seed i PoC)"
fi
echo "Provisionering færdig."
