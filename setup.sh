#!/usr/bin/env bash
# Opretter .env med tilfældige hemmeligheder og data-mapperne. Rører ikke en eksisterende .env,
# medmindre du kun angiver --ip (så opdateres kun PUBLIC_URL).
#
#   ./setup.sh --ip 192.168.1.23            første opsætning, mobilen når serveren på denne adresse
#   ./setup.sh --ip 192.168.1.23 --email mig@example.dk
#   ./setup.sh --ip 192.168.1.50            senere: skift kun adressen (fx efter ny DHCP-adresse)
#
# Avanceret (fx en ekstra instans til at teste gendannelse): ENV_FILE=.env.test DATA_DIR=./data-test \
#   DIRECTUS_PORT=8056 COMPOSE_PROJECT_NAME=logearkiv-test ./setup.sh
set -euo pipefail
cd "$(dirname "$0")"

IP=""; EMAIL="admin@logearkiv.example.com"
while [ $# -gt 0 ]; do
  case "$1" in
    --ip)    IP="${2:?--ip kræver en adresse}"; shift 2 ;;
    --email) EMAIL="${2:?--email kræver en adresse}"; shift 2 ;;
    -h|--help) sed -n '2,11p' "$0"; exit 0 ;;
    *) echo "Ukendt argument: $1" >&2; exit 1 ;;
  esac
done

rand_hex()   { head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; }
rand_alnum() { { LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$1"; } || true; }

ENV_FILE="${ENV_FILE:-.env}"
PORT="${DIRECTUS_PORT:-8055}"
public_url() { echo "http://${IP:-localhost}:${PORT}"; }

if [ -f "$ENV_FILE" ]; then
  if [ -n "$IP" ]; then
    sed -i "s|^PUBLIC_URL=.*|PUBLIC_URL=$(public_url)|" "$ENV_FILE"
    echo "PUBLIC_URL opdateret til $(public_url). Kør: docker compose up -d"
    exit 0
  fi
  echo "$ENV_FILE findes allerede - rører den ikke. (Brug --ip <adresse> for kun at skifte PUBLIC_URL.)"
  exit 0
fi

HOST_UID_VAL="$(id -u)"; HOST_GID_VAL="$(id -g)"
# Kører du som root (fx i en container), bruger vi 1000, som er directus' egen bruger.
if [ "$HOST_UID_VAL" = "0" ]; then HOST_UID_VAL=1000; HOST_GID_VAL=1000; fi

ADMIN_PASSWORD="$(rand_alnum 24)"

umask 077
cat > "$ENV_FILE" <<ENVEOF
KEY=$(rand_hex 32)
SECRET=$(rand_hex 32)
ADMIN_EMAIL=${EMAIL}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
DB_DATABASE=directus
DB_USER=directus
DB_PASSWORD=$(rand_alnum 32)
PUBLIC_URL=$(public_url)
HOST_UID=${HOST_UID_VAL}
HOST_GID=${HOST_GID_VAL}
TESTBRUGER_PASSWORD=$(rand_alnum 20)
ENVEOF
for v in DATA_DIR DIRECTUS_PORT COMPOSE_PROJECT_NAME; do
  [ -n "${!v:-}" ] && echo "$v=${!v}" >> "$ENV_FILE"
done
umask 022

DATA="${DATA_DIR:-./data}"
mkdir -p "$DATA/postgres" "$DATA/uploads" backup
if [ "$(id -u)" = "0" ]; then chown "${HOST_UID_VAL}:${HOST_GID_VAL}" "$DATA/uploads"; fi

cat <<MSG

${ENV_FILE} oprettet (rettigheder 600, ligger ikke i git).

  Admin-login : ${EMAIL}
  Kodeord     : ${ADMIN_PASSWORD}

  GEM KODEORDET NU - det vises kun denne ene gang her (det ligger også i ${ENV_FILE}).
  Adresse     : $(public_url)

Næste skridt:  docker compose up -d   og derefter   ./scripts/provision.sh
MSG
if [ -z "$IP" ]; then
  echo
  echo "Bemærk: du angav ikke --ip, så PUBLIC_URL er http://localhost:8055. Mobilen kan ikke bruge localhost -"
  echo "kør ./setup.sh --ip <Chromebookens Wi-Fi-adresse> når du kender den (se README, trin 1)."
fi
