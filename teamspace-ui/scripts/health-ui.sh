#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose ps
curl -fsS http://127.0.0.1:8081/api/health
printf '\n'
for service in workspace-api workspace-web; do
  id=$(docker compose ps -q "$service")
  [[ -n "$id" && $(docker inspect --format '{{.State.Health.Status}}' "$id") == healthy ]] || exit 1
done
docker compose exec -T workspace-api node --input-type=module -e '
const r=await fetch("http://app/status.php");const s=await r.json();
if(!r.ok||!s.installed||s.maintenance||s.needsDbUpgrade)process.exit(1);
console.log("Nextcloud reachable and installed");'
