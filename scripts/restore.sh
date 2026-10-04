#!/usr/bin/env bash
# Gendan en backup i den stak der kører ud fra den valgte .env. OVERSKRIVER database og uploads.
#   ./scripts/restore.sh backup/2026-10-04_030000          (spørger først)
#   ./scripts/restore.sh --yes backup/2026-10-04_030000    (uden spørgsmål)
#
# Ny, tom server:  git clone ... && ./setup.sh --ip <adresse> && ./scripts/restore.sh <backup-mappe>
set -euo pipefail
. "$(dirname "$0")/_common.sh"
YES=0; [ "${1:-}" = "--yes" ] && { YES=1; shift; }
SRC="${1:?Angiv backup-mappen, fx: ./scripts/restore.sh backup/2026-10-04_030000}"
SRC="${SRC%/}"
for f in db.sql.gz uploads.tar.gz SHA256SUMS; do [ -f "$SRC/$f" ] || { echo "$SRC/$f mangler - ikke en gyldig backup." >&2; exit 1; }; done
(cd "$SRC" && sha256sum -c SHA256SUMS)

if [ "$YES" != 1 ]; then
  read -r -p "Database og uploads (${DATA_DIR}/uploads) overskrives med $SRC. Skriv 'ja' for at fortsætte: " answer
  [ "$answer" = "ja" ] || { echo "Afbrudt."; exit 1; }
fi

echo "1/4 Stopper Directus, starter databasen ..."
docker compose stop directus >/dev/null 2>&1 || true
docker compose up -d --wait database

echo "2/4 Gendanner database ..."
gunzip -c "$SRC/db.sql.gz" | docker compose exec -T database sh -c 'psql -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null

echo "3/4 Gendanner uploads ..."
UPLOADS="$DATA_DIR/uploads"
mkdir -p "$UPLOADS"
find "$UPLOADS" -mindepth 1 -delete
tar -C "$DATA_DIR" -xzf "$SRC/uploads.tar.gz"

echo "4/4 Starter Directus ..."
docker compose up -d --wait

# Admin-kodeordet i den gendannede database er det gamle. Så ADMIN_PASSWORD i den nuværende .env passer
# (ellers kan provisionerings-/testscripts ikke logge ind), sættes det til værdien i .env.
if docker compose exec -T database sh -c 'psql -tA -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select 1 from directus_users where email = '"'$ADMIN_EMAIL'"'"' | grep -q 1; then
  docker compose exec -T directus node cli.js users passwd --email "$ADMIN_EMAIL" --password "$ADMIN_PASSWORD" >/dev/null
  echo "Admin-kodeord ($ADMIN_EMAIL) sat til ADMIN_PASSWORD fra $ENV_FILE."
else
  echo "OBS: $ADMIN_EMAIL findes ikke i den gendannede database. Log ind med den gamle admin-bruger fra backuppen."
fi
echo "Gendannelse færdig."
