#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose ps
docker compose exec -T -u www-data app php occ status --output=json
curl --fail --silent --show-error http://127.0.0.1:8080/status.php
printf '\n'
for service in db redis app; do
  id=$(docker compose ps -q "$service")
  [[ -n "$id" && $(docker inspect --format '{{.State.Health.Status}}' "$id") == healthy ]] || exit 1
done
id=$(docker compose ps -q cron)
[[ -n "$id" && $(docker inspect --format '{{.State.Running}}' "$id") == true ]]
