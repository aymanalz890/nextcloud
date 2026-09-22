#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Run with sudo."; exit 1; }
cd "$(dirname "$0")/.."
[[ -f .env ]] || { echo "Existing .env not found. For first install use scripts/start-ui.sh."; exit 1; }
docker compose config --quiet
docker compose up -d --build --wait --wait-timeout 300
bash scripts/health-ui.sh
echo "Teamspace updated. Refresh your browser and sign in again."
