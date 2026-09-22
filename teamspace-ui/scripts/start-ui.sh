#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Run with sudo."; exit 1; }
cd "$(dirname "$0")/.."
[[ -f /opt/nextcloud/compose.yaml ]] || { echo "Existing Nextcloud installation not found in /opt/nextcloud."; exit 1; }
docker network inspect nextcloud_frontend >/dev/null
base_compose=(docker compose --project-directory /opt/nextcloud -f /opt/nextcloud/compose.yaml)
"${base_compose[@]}" exec -T -u www-data app php occ status
if ! "${base_compose[@]}" exec -T -u www-data app php occ config:system:get trusted_domains | grep -Fxq app; then
  next_index=$("${base_compose[@]}" exec -T -u www-data app php -r 'require "/var/www/html/config/config.php"; $keys=array_keys($CONFIG["trusted_domains"] ?? []); echo $keys ? max($keys)+1 : 0;')
  [[ "$next_index" =~ ^[0-9]+$ ]] || { echo "Could not determine trusted-domain index."; exit 1; }
  "${base_compose[@]}" exec -T -u www-data app php occ config:system:set trusted_domains "$next_index" --value=app
fi
[[ -f .env ]] || cp .env.example .env
chmod 600 .env
docker compose config --quiet
docker compose up -d --build --wait --wait-timeout 300
bash scripts/health-ui.sh
echo "Teamspace is ready on VM loopback port 8081. Open the SSH tunnel from your computer."
