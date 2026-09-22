#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Run with sudo."; exit 1; }
cd "$(dirname "$0")/.."
umask 077
exec 9>/run/nextcloud-backup.lock
flock -n 9 || { echo "Backup already running."; exit 1; }
bash scripts/health.sh
backup_dir="/var/backups/nextcloud/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup_dir"
resume() { docker compose start app cron; }
trap resume EXIT
docker compose stop cron app
docker compose exec -T db pg_dump -U nextcloud -d nextcloud -Fc > "$backup_dir/database.dump"
tar --numeric-owner -czf "$backup_dir/html.tar.gz" -C /srv/nextcloud html
tar -czf "$backup_dir/deployment.tar.gz" .env secrets compose.yaml scripts .env.example
docker compose images > "$backup_dir/images.txt"
for image_id in $(docker compose images -q | sort -u); do
  docker image inspect --format '{{json .RepoDigests}}' "$image_id" >> "$backup_dir/images.txt"
done
(cd "$backup_dir" && sha256sum database.dump html.tar.gz deployment.tar.gz > SHA256SUMS)
touch "$backup_dir/COMPLETE"
echo "Backup complete: $backup_dir. Copy securely off this VM."
