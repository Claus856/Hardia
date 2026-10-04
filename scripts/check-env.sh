#!/usr/bin/env bash
# Miljøtjek: Docker, docker compose, adgang til Docker, ledig port og netværksadresser.
#   ./scripts/check-env.sh              kun tjek (ændrer intet)
#   ./scripts/check-env.sh --install    installerer Docker CE + compose-plugin fra Dockers egen apt-kilde
#                                       (Debian/Ubuntu - Chrome OS' Linux-miljø er Debian). Kræver sudo.
#                                       Røre ikke ved eksisterende pakker ud over at tilføje Dockers apt-kilde.
set -uo pipefail

ok()   { printf '  \033[32mOK\033[0m    %s\n' "$*"; }
warn() { printf '  \033[33mOBS\033[0m   %s\n' "$*"; }
bad()  { printf '  \033[31mFEJL\033[0m  %s\n' "$*"; PROBLEMS=$((PROBLEMS + 1)); }
PROBLEMS=0

install_docker() {
  . /etc/os-release
  case "${ID:-}" in debian|ubuntu) ;; *) echo "Automatisk installation er kun lavet til Debian/Ubuntu (dette er: ${ID:-ukendt})." >&2; exit 1 ;; esac
  echo "Installerer Docker CE på ${PRETTY_NAME} ..."
  sudo apt-get update
  sudo apt-get install -y ca-certificates curl
  sudo install -m 0755 -d /etc/apt/keyrings
  sudo curl -fsSL "https://download.docker.com/linux/${ID}/gpg" -o /etc/apt/keyrings/docker.asc
  sudo chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${ID} ${VERSION_CODENAME} stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  sudo systemctl enable --now docker 2>/dev/null || sudo service docker start || true
  sudo usermod -aG docker "$USER"
  echo
  echo "Docker er installeret. Luk Linux-terminalen helt og åbn den igen (så gruppen 'docker' slår igennem), og kør så dette script igen."
  exit 0
}

[ "${1:-}" = "--install" ] && install_docker

echo "Miljøtjek"
. /etc/os-release 2>/dev/null && ok "OS: ${PRETTY_NAME:-ukendt}"
if [ -e /dev/.cros_milestone ] || [ "$(hostname)" = "penguin" ]; then
  ok "Chrome OS Linux-miljø (Crostini) - portvideresendelse i Chrome OS er nødvendig for at mobilen kan nå serveren (se README)"
fi

if command -v docker >/dev/null; then
  ok "$(docker --version)"
else
  bad "Docker er ikke installeret - kør: ./scripts/check-env.sh --install"
fi

if docker compose version >/dev/null 2>&1; then
  ok "$(docker compose version)"
else
  bad "docker compose (v2-plugin) mangler - kør: ./scripts/check-env.sh --install"
fi

if command -v docker >/dev/null; then
  if out="$(docker info 2>&1 >/dev/null)"; then
    ok "Docker-dæmonen svarer"
  elif echo "$out" | grep -qi "permission denied"; then
    bad "Ingen adgang til Docker. Kør: sudo usermod -aG docker \$USER   - og åbn så terminalen igen"
  else
    bad "Docker-dæmonen kører ikke. Prøv: sudo systemctl enable --now docker   (eller: sudo service docker start)"
  fi
fi

if command -v ss >/dev/null && ss -ltn 2>/dev/null | grep -q ':8055 '; then
  warn "Port 8055 er allerede i brug (kører logearkiv allerede? ellers: sæt DIRECTUS_PORT i .env)"
else
  ok "Port 8055 er ledig"
fi

mem_mb="$(awk '/MemTotal/ {printf "%d", $2/1024}' /proc/meminfo)"
if [ "${mem_mb:-0}" -lt 2000 ]; then warn "Kun ${mem_mb} MB RAM - Directus + Postgres vil være trange (anbefalet mindst 2 GB)."; else ok "RAM: ${mem_mb} MB"; fi
ok "Ledig diskplads her: $(df -h . | awk 'NR==2 {print $4}')"

echo
echo "Netværk"
echo "  hostname -I  ->  $(hostname -I 2>/dev/null)"
echo "  (I Chrome OS' Linux-miljø er det en INTERN adresse, fx 100.115.92.x. Den kan mobilen ikke bruge."
echo "   Mobilen skal bruge Chromebookens Wi-Fi-adresse + videresendt port - se README, 'Trin 1'.)"

echo
if [ "$PROBLEMS" -eq 0 ]; then echo "Klar til: ./setup.sh --ip <Chromebookens Wi-Fi-adresse>"; else echo "$PROBLEMS problem(er) skal løses først."; exit 1; fi
