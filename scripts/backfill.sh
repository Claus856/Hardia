#!/usr/bin/env bash
# Kører tekstudtræk og søgeordsforslag for ALLE poster i arkivmateriale (én gang efter opgradering, eller efter
# ændring af stopord/grænser). Poster, hvor resultatet er uændret, skrives ikke igen, så scriptet kan gentages.
# Feltet søgeord (de godkendte) røres aldrig.
#   ./scripts/backfill.sh
set -euo pipefail
. "$(dirname "$0")/_common.sh"

docker compose up -d --wait >/dev/null 2>&1
kald() { docker compose exec -T tekstservice python -c '
import sys, urllib.request
print(urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:8000" + sys.argv[2], method=sys.argv[1]), timeout=120).read().decode())' "$@"; }

echo "Sætter alle poster i kø: $(kald POST /backfill)"
while :; do
  status="$(kald GET /status)"
  case "$status" in *'"udestaaende":0,'*) break ;; esac
  echo "  $status"
  sleep 5
done
echo "Færdig (tællere siden tjenesten startede): $status"
echo "Detaljer og fejl: docker compose logs tekstservice"
