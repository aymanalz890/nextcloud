# Teamspace UI

Custom React frontend and Node.js API for an Azure-hosted Nextcloud deployment.

## Features

- File upload, download, folder creation, rename, move, and deletion
- Internal user and group sharing with read-only or edit permissions
- File version listing, download, and restoration
- Administrator interface for user creation, group membership, and account status

The API authenticates each user against Nextcloud and uses its WebDAV and
OCS APIs. Nextcloud enforces file access permissions.

Document collaboration uses download, local editing, and reupload.
Simultaneous browser-based document editing is not included.

## Stack

React · Vite · Express · Nginx · Docker Compose

## Prerequisites

- Running Nextcloud stack at `/opt/nextcloud`
- Docker Engine and Docker Compose
- Existing Docker network `nextcloud_frontend`

## Deploy

Copy this project to `/opt/nextcloud/teamspace-ui`, then run on the VM:

```bash
cd /opt/nextcloud/teamspace-ui
sudo bash scripts/start-ui.sh
```

The startup script creates `.env` from `.env.example` if needed, configures
Nextcloud's internal trusted hostname, and builds and starts the UI services.

From your local machine, open an SSH tunnel:

```bash
ssh -i ~/.ssh/nextcloud_key -N \
  -L 127.0.0.1:8081:127.0.0.1:8081 azureuser@VM_PUBLIC_IP
```

Open **http://localhost:8081** and sign in with a Nextcloud account.
Members of the Nextcloud `admin` group can access **Users & Groups**.

## Configuration

| Variable | Default |
|---|---|
| `UI_ORIGIN` | `http://localhost:8081` |
| `COOKIE_SECURE` | `false` |

The browser origin must match `UI_ORIGIN`. Enable secure cookies when
deploying behind HTTPS. The default configuration uses an SSH tunnel.

Uploads are limited to 100 MiB per file. Sessions are held in API memory;
restarting the API requires users to sign in again.

## Operations

Run from `/opt/nextcloud/teamspace-ui`:

```bash
sudo bash scripts/health-ui.sh
sudo docker compose logs --tail=100 workspace-api workspace-web
sudo bash scripts/update-ui.sh
```

`update-ui.sh` rebuilds from source already present in the deployment directory.
See [UPDATE.md](UPDATE.md) for staged uploads, installation, and rollback.

## Development and Tests

Requires Node.js 22 or later.

```bash
npm ci
npm test
npm run build
```

To launch the local simulated backend and UI:

```bash
node tests/preview-server.js
```

Open **http://localhost:8081** using `ayman` / `test-app-password`.
These credentials are for the local test fixture only.

API tests use a simulated Nextcloud server. Verify sharing, permissions,
and version history separately against the deployed instance.