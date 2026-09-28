#!/usr/bin/env bash
set -euo pipefail

main() {
  [[ $EUID -eq 0 ]] || { echo "Run with sudo."; exit 1; }
  umask 077
  root=$(cd "$(dirname "$0")/.." && pwd -P)
  cd "$root"
  exec 9>/run/teamspace-management.lock
  flock -n 9 || { echo "Another management operation is running."; exit 1; }
  dc() { docker compose --project-directory "$root" -f "$root/compose.yaml" "$@"; }
  occ() { dc exec -T -u www-data app php occ "$@"; }
  check_config() {
    [[ -f .env ]] || { echo "Copy .env.example to .env and set UI_ORIGIN first."; exit 1; }
    if grep -q 'YOUR-VM-PUBLIC-IP' .env; then
      echo "Set UI_ORIGIN to the actual browser URL in .env."; exit 1
    fi
    dc config --quiet
  }
  health() {
    dc ps
    for service in db redis app workspace-api workspace-web; do
      id=$(dc ps -q "$service")
      [[ -n "$id" && $(docker inspect --format '{{.State.Health.Status}}' "$id") == healthy ]] || {
        echo "Unhealthy service: $service"; return 1;
      }
    done
    id=$(dc ps -q cron)
    [[ -n "$id" && $(docker inspect --format '{{.State.Running}}' "$id") == true ]]
    occ status --output=json
    curl -fsS http://127.0.0.1:8081/api/health
    printf '\n'
  }
  deploy() {
    # A legacy UI would conflict with the new frontend on port 8081.
    [[ -z $(docker ps -q --filter label=com.docker.compose.project=teamspace) ]] || {
      echo "Legacy UI is running. Use: sudo bash scripts/manage.sh migrate"; return 1;
    }
    [[ -f .env ]] || { echo "Copy .env.example to .env and set UI_ORIGIN."; return 1; }
    check_config
    install -d -m 700 secrets
    for secret in db_password admin_password; do
      if [[ ! -s secrets/$secret ]]; then
        if [[ -f /srv/nextcloud/html/config/config.php || -f /srv/nextcloud/postgres/PG_VERSION ]]; then
          echo "Existing data but missing $secret. Restore the original secrets or use migrate."; return 1
        fi
        openssl rand -hex 32 > "secrets/$secret"
      fi
    done
    chmod 600 .env secrets/*
    # Build before changing containers, so compilation failures cause no downtime.
    dc build workspace-api workspace-web
    dc up -d --wait --wait-timeout 900 db redis app
    occ background:cron
    occ config:app:set core shareapi_allow_links --value=no
    dc up -d --wait --wait-timeout 300
    health
  }
  backup() (
    health
    backup_dir="/var/backups/teamspace/$(date -u +%Y%m%dT%H%M%SZ)-$$"
    mkdir -p "$backup_dir"
    trap 'dc start app cron workspace-api workspace-web' EXIT
    dc stop workspace-web workspace-api cron app
    dc exec -T db pg_dump -U nextcloud -d nextcloud -Fc > "$backup_dir/database.dump"
    tar --numeric-owner -czf "$backup_dir/html.tar.gz" -C /srv/nextcloud html
    tar --exclude='./node_modules' --exclude='./dist' --exclude='./.git' \
      --exclude='./test-artifacts' --exclude='./terraform' -czf "$backup_dir/deployment.tar.gz" .
    dc images > "$backup_dir/images.txt"
    for image_id in $(dc images -q | sort -u); do
      docker image inspect --format '{{json .RepoDigests}}' "$image_id" >> "$backup_dir/images.txt"
    done
    (cd "$backup_dir" && sha256sum database.dump html.tar.gz deployment.tar.gz > SHA256SUMS)
    touch "$backup_dir/COMPLETE"
    echo "Backup: $backup_dir — export it off this VM."
  )
  update() {
    target=/opt/teamspace
    [[ "$root" != "$target" && -f "$target/.env" && -f "$target/compose.yaml" ]] || {
      echo "Run update from a fresh uploaded release; existing deployment must be /opt/teamspace."; return 1;
    }
    items=(api web scripts tests terraform package.json package-lock.json Dockerfile.api Dockerfile.web nginx.conf compose.yaml .env.example .dockerignore .gitignore .gitattributes README.md)
    stage=$(mktemp -d /opt/.teamspace-release.XXXXXX)
    trap 'rm -rf -- "$stage"' EXIT
    for item in "${items[@]}"; do
      [[ -e "$root/$item" ]] || { echo "Incomplete release: missing $item"; return 1; }
      cp -a "$root/$item" "$stage/"
    done
    install -d -m 700 /var/backups/teamspace-code
    archive="/var/backups/teamspace-code/$(date -u +%Y%m%dT%H%M%SZ)-$$.tar.gz"
    tar --exclude='teamspace/node_modules' --exclude='teamspace/dist' \
      --exclude='teamspace/.git' --exclude='teamspace/test-artifacts' \
      -czf "$archive" -C /opt teamspace
    for item in "${items[@]}"; do
      # Terraform state belongs on the operator's computer, not this deployment.
      if [[ "$item" == terraform ]]; then continue; fi
      rm -rf -- "$target/$item"
      mv -- "$stage/$item" "$target/$item"
    done
    chown -R root:root "$target"
    echo "Code backup: $archive"
    flock -u 9
    bash "$target/scripts/manage.sh" deploy
  }
  migrate() {
    [[ "$root" == /opt/teamspace ]] || { echo "Install this release at /opt/teamspace first."; return 1; }
    old=/opt/nextcloud
    [[ -f "$old/compose.yaml" && -f "$old/teamspace-ui/compose.yaml" ]] || {
      echo "Legacy deployment not found under /opt/nextcloud."; return 1;
    }
    [[ ! -e .env && ! -e secrets ]] || {
      echo "Target already has .env or secrets. Refusing to overwrite; inspect migration progress."; return 1;
    }
    for file in .env secrets/db_password secrets/admin_password teamspace-ui/.env; do
      [[ -s "$old/$file" ]] || { echo "Missing legacy file: $file"; return 1; }
    done
    # Verify the new release can build before stopping any legacy services.
    docker compose build workspace-api workspace-web
    bash "$old/scripts/backup.sh"
    cp -a "$old/secrets" ./secrets
    { cat "$old/.env"; printf '\n'; cat "$old/teamspace-ui/.env"; printf '\n'; } > .env
    chmod 600 .env secrets/*
    check_config
    docker compose --project-directory "$old/teamspace-ui" -f "$old/teamspace-ui/compose.yaml" down
    docker compose --project-directory "$old" -f "$old/compose.yaml" down
    deploy
    echo "Migration complete. Legacy configuration remains at /opt/nextcloud for rollback."
  }
  case "${1:-}" in
    deploy) deploy ;;
    status) health ;;
    backup) backup ;;
    stop) dc stop ;;
    update) update ;;
    migrate) migrate ;;
    *) echo "Usage: sudo bash scripts/manage.sh {deploy|status|backup|stop|update|migrate}"; exit 2 ;;
  esac
}
main "$@"
