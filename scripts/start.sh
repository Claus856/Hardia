#!/usr/bin/env bash
# Starter Logearkiv og åbner det i browseren. Bruges af genvejen i Chrome OS' appstarter
# (~/.local/share/applications/logearkiv.desktop), men kan også køres direkte: ./scripts/start.sh
# Genvejen har intet terminalvindue, så output havner i data/start.log, og fejl vises som notifikation.
set -euo pipefail
. "$(dirname "$0")/_common.sh"
URL="http://localhost:${DIRECTUS_PORT:-8055}"
LOG="$DATA_DIR/start.log"

if ! docker compose up -d --wait >"$LOG" 2>&1; then
  echo "Logearkiv kunne ikke starte - se $LOG" >&2
  command -v notify-send >/dev/null && notify-send "Logearkiv kunne ikke starte" "Se $PWD/${LOG#./}"
  exit 1
fi
xdg-open "$URL" >/dev/null 2>&1
