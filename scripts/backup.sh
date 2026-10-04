#!/usr/bin/env bash
# Backup til ./backup/<dato>/ : databasen (pg_dump), uploads og et schema-snapshot. Beholder de seneste 7.
#   ./scripts/backup.sh            (KEEP=14 ./scripts/backup.sh for at beholde flere)
# Kan køres mens systemet er i brug. Læg gerne et cron-job på: 0 3 * * *  cd ~/logearkiv && ./scripts/backup.sh
set -euo pipefail
. "$(dirname "$0")/_common.sh"
KEEP="${KEEP:-7}"
DEST="backup/$(date +%Y-%m-%d_%H%M%S)"
mkdir -p "$DEST"
trap 'echo "Backup fejlede - fjerner halv backup $DEST" >&2; rm -rf "$DEST"' ERR

echo "1/3 Database ..."
docker compose exec -T database sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --no-privileges' \
  | gzip > "$DEST/db.sql.gz"

echo "2/3 Uploads ..."
# Thumbnails (<id>__<hash>.<ext>) genereres igen efter behov og tages ikke med.
tar -C "$DATA_DIR" --exclude='*__*' -czf "$DEST/uploads.tar.gz" uploads

echo "3/3 Schema-snapshot ..."
docker compose exec -T directus node cli.js schema snapshot --yes --format yaml /tmp/snapshot.yaml >/dev/null
docker compose exec -T directus cat /tmp/snapshot.yaml > "$DEST/snapshot.yaml"

(cd "$DEST" && sha256sum db.sql.gz uploads.tar.gz snapshot.yaml > SHA256SUMS)
trap - ERR

# Behold de nyeste $KEEP
ls -1d backup/*/ 2>/dev/null | sort | head -n "-$KEEP" | xargs -r rm -rf

echo "Backup færdig: $DEST ($(du -sh "$DEST" | cut -f1))"
echo "Husk: .env (hemmeligheder) er IKKE med i backuppen - opbevar den separat og sikkert."
