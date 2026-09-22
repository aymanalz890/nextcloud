#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Run with sudo."; exit 1; }
umask 077
source_dir=$(cd "$(dirname "$0")/.." && pwd -P)
target_dir=/opt/nextcloud/teamspace-ui
[[ -f "$target_dir/.env" && -f "$target_dir/compose.yaml" ]] || {
  echo "Existing Teamspace installation not found. Use start-ui.sh for a first install."; exit 1;
}
[[ "$source_dir" != "$target_dir" ]] || {
  echo "Run this installer from the uploaded teamspace-ui-update directory."; exit 1;
}
for item in api web scripts package.json package-lock.json Dockerfile.api Dockerfile.web compose.yaml nginx.conf .dockerignore; do
  [[ -e "$source_dir/$item" ]] || { echo "Missing update file: $item"; exit 1; }
done
backup_dir=/opt/nextcloud/ui-code-backups
install -d -m 700 "$backup_dir"
backup_file="$backup_dir/teamspace-$(date -u +%Y%m%dT%H%M%SZ)-$$.tar.gz"
tar --exclude='teamspace-ui/node_modules' --exclude='teamspace-ui/dist' \
  --exclude='teamspace-ui/test-artifacts' -czf "$backup_file" -C /opt/nextcloud teamspace-ui
for item in api web scripts package.json package-lock.json Dockerfile.api Dockerfile.web compose.yaml nginx.conf .dockerignore; do
  cp -a "$source_dir/$item" "$target_dir/"
done
chown -R root:root "$target_dir"
echo "Previous application code saved in $backup_file"
bash "$target_dir/scripts/update-ui.sh"
