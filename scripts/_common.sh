# Fælles opsætning til scripts/*.sh (source'es, køres ikke direkte).
# Gør det muligt at køre alle scripts mod en anden instans: ENV_FILE=.env.test ./scripts/backup.sh
cd "$(dirname "${BASH_SOURCE[0]}")/.."
ENV_FILE="${ENV_FILE:-.env}"
[ -f "$ENV_FILE" ] || { echo "$ENV_FILE mangler - kør ./setup.sh først." >&2; exit 1; }
export COMPOSE_ENV_FILES="$ENV_FILE"
set -a; . "./$ENV_FILE"; set +a
DATA_DIR="${DATA_DIR:-./data}"
