#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Run with sudo."; exit 1; }
cd "$(dirname "$0")/.."
umask 077
[[ -f .env ]] || cp .env.example .env
install -d -m 700 secrets
for secret in db_password admin_password; do
  if [[ ! -s secrets/$secret ]]; then
    if [[ -f /srv/nextcloud/html/config/config.php || -f /srv/nextcloud/postgres/PG_VERSION ]]; then
      echo "Missing secret on an existing installation: restore the original secrets." >&2
      exit 1
    fi
    openssl rand -hex 32 > "secrets/$secret"
  fi
done
chmod 600 .env secrets/*
mkdir -p /srv/nextcloud/html /srv/nextcloud/postgres
docker compose config --quiet
docker compose up -d --wait --wait-timeout 900
docker compose exec -T -u www-data app php occ background:cron
docker compose exec -T -u www-data app php occ config:system:set shareapi_allow_links --type=boolean --value=false
bash scripts/health.sh
echo "Ready. Admin name is in .env; password is in secrets/admin_password."
