# Teamspace — custom React interface for your Nextcloud project

**Already installed? Follow [UPDATE.md](UPDATE.md) to add Users & Groups.**

A custom dashboard for files, folders, internal sharing and version history.
Nextcloud remains the authority for storage and permissions. The app connects as
the signed-in user; it does not use a shared administrator account.

This is an **add-on for the existing Nextcloud installation in `/opt/nextcloud`**.
It does not provision Azure resources or migrate/delete any Nextcloud data.
Your existing VM, Terraform configuration, database, cache, cron and file storage
continue to be used. Do not run `terraform destroy` or initialize a new database.

## Included functionality

| Requirement | Implementation |
|---|---|
| Upload/storage | Multi-file uploads with progress, 100 MB per-file limit, downloads |
| Folders | Browse, breadcrumbs, create, rename, move, delete with confirmation |
| Team sharing | User/group search, read/edit access, permission updates, share removal |
| Collaboration/versions | Shared files, revision uploads, version list/download/restore |
| Access control | Per-user authentication, admin-only user/group management, fresh role checks and upstream enforcement |
| Repeatable deployment | Dockerfiles, Compose, pinned npm dependencies and lockfile, Bash scripts |

Collaboration here means shared access and document revision workflows. Editing
Office documents together in the browser requires an additional editor service.
Administrators use Teamspace’s **Users & Groups** page to create users/groups,
manage membership, and disable/enable ordinary accounts.
Received shares appear in All files once accepted; if auto-accept is disabled,
accept the share in the original Nextcloud UI first. The Shared by me page shows
outgoing shares. Search filters the current folder; it is not a recursive search.
Trash recovery, public links, previews and Office co-editing are not included.

## Architecture

The browser loads React through nginx. The same nginx routes `/api/` to the Node
API. The API authenticates to Nextcloud using the current user's password or app
password, then uses WebDAV for files/versions and OCS for sharing. The browser never
receives a Nextcloud administrator secret or another user's credentials.

| Container | Purpose | Network access |
|---|---|---|
| workspace-web | nginx serving compiled React | VM loopback port 8081 only |
| workspace-api | Express backend | No published host port; connects to app:80 |
| Existing app | Nextcloud | Unchanged loopback port 8080; shared Docker network |

Two Compose projects are used: existing `nextcloud`, new `teamspace`. The new API
joins the existing `nextcloud_frontend` Docker network. The startup script adds
`app` to Nextcloud's trusted domains without removing existing entries. No new
Azure inbound rule or public web port is required.

## Deploy from Git Bash

### 1. Confirm Nextcloud is running

On your computer, use the same SSH key as before. The example uses the VM IP from
this project; if it has changed, substitute its current public IP.

```bash
ssh -i ~/.ssh/nextcloud_key azureuser@20.171.65.134
```

On the VM:

```bash
cd /opt/nextcloud
sudo docker compose ps
```

If you intentionally stopped the base stack earlier, restart it:

```bash
sudo bash scripts/start.sh
```

### 2. Upload the add-on

Extract `teamspace-ui.zip` on your computer. Open a **local Git Bash window in the
folder containing the extracted `teamspace-ui` directory**, then run:

```bash
scp -i ~/.ssh/nextcloud_key -r teamspace-ui azureuser@20.171.65.134:~/
```

This ZIP contains source and the npm lockfile, not passwords or node_modules.
Do not copy the old Terraform folder or private key onto the VM.

### 3. Build and start on the VM

Back in the VM's SSH terminal:

```bash
sudo mkdir -p /opt/nextcloud/teamspace-ui
sudo cp -a ~/teamspace-ui/. /opt/nextcloud/teamspace-ui/
sudo chown -R root:root /opt/nextcloud/teamspace-ui
cd /opt/nextcloud/teamspace-ui
sudo bash scripts/start-ui.sh
```

The first build downloads npm dependencies and images and may take several minutes.
It requires outbound access to Docker Hub, npm and their download infrastructure.
Subsequent builds use Docker caching. Existing Nextcloud data is not touched.
If the script reports an error, stop there and use the troubleshooting section.

### 4. Open the React dashboard

In a **separate local Git Bash window**:

```bash
ssh -i ~/.ssh/nextcloud_key -N -o ExitOnForwardFailure=yes \
  -L 127.0.0.1:8081:127.0.0.1:8081 \
  -L 127.0.0.1:8080:127.0.0.1:8080 \
  azureuser@20.171.65.134
```

Keep the tunnel open. If you already have a tunnel using local port 8080, close
that older tunnel with Ctrl+C first, or omit the 8080 line from the new command.

- **Custom React dashboard:** http://localhost:8081
- **Original Nextcloud UI/admin:** http://localhost:8080

Use **localhost**, not the VM IP or `127.0.0.1`, in your browser: the configured
origin is exactly `http://localhost:8081` for request validation.

Sign in with your existing Nextcloud username and password. With two-factor
authentication, use an app password from Nextcloud → Personal settings → Security.
App passwords are preferable for testing because they can be revoked independently.
Administrators create Nextcloud-backed accounts through Teamspace; there is no public self-registration. Your existing admin is
`ncadmin` unless you changed it; use ordinary accounts for permission tests.

## Acceptance walkthrough on your live VM

Use only synthetic test files until this walkthrough passes.

1. In Teamspace **Users & Groups**, create `alice`, `bob` and `charlie`, plus
   `Project-Team`; add Alice and Bob only. Accounts inherit the server’s quota defaults.
2. Login to Teamspace as Alice. Create `Project-Alpha`, open it, upload a text file.
3. Select the file and download it; compare contents with the original.
4. Select the folder using its `…` button, open Sharing, search `Project-Team`,
   select the group and choose Can edit. Click Share.
5. In a separate browser profile, login as Bob and open the received folder from
   All files. If it is absent, accept the invitation in the original Nextcloud UI.
6. Bob changes the local test file and uploads it with the same name; confirm the
   replacement. Alice refreshes, selects it and opens Versions. Download an older
   revision and compare; restore it and download the current file to verify.
7. Alice changes the group share to Read only. Bob refreshes and confirms writes
   are disabled. Nextcloud must also reject attempted writes through its APIs.
8. Login as Charlie; confirm the shared folder is inaccessible. Do not test using
   the admin account as a nonmember—admins have special capabilities.
9. Test rename/move/delete on disposable items. Folder deletion is recursive;
   confirmation is required. Move accepts a full destination path whose parent
   folder already exists; it does not overwrite existing files.
10. Restart the add-on and log in again. Files and shares must remain. Run your
    original backup script and rehearse recovery before using important data.

Version creation and retention are controlled by Nextcloud; very rapid revisions
may be consolidated. If history is empty, confirm the `files_versions` app is
enabled and check the base Nextcloud UI. Shared-file version operations may also
be restricted by Nextcloud permissions or server policies.

## Operations and troubleshooting

Run these **on the VM from `/opt/nextcloud/teamspace-ui`**:

```bash
sudo bash scripts/health-ui.sh
sudo docker compose logs --tail=100 workspace-api workspace-web
sudo bash scripts/stop-ui.sh
sudo bash scripts/start-ui.sh
```

- `health-ui.sh` checks both new containers and Nextcloud connectivity. It does
  not replace the signed-in acceptance tests above.
- Starting/stopping this add-on does not stop the existing Nextcloud project.
  Stop this add-on before running `docker compose down` on the base project,
  so its external Docker network can be removed cleanly.
- Restarting the API logs everyone out; sign in again. Files remain in Nextcloud.
- `Request origin was rejected`: use http://localhost:8081. If you deliberately
  change the URL, update `.env` UI_ORIGIN and recreate the add-on containers.
- `Connection refused`: confirm the VM is running, the SSH tunnel is open and
  `docker compose ps` shows both add-on containers running.
- SSH timeout: check your current public IPv4 against the base Terraform
  `admin_cidr` and apply a fresh plan if it changed.
- `network nextcloud_frontend not found`: start the original base stack first.
  This add-on expects the supplied base Compose project/network names.
- Login rejected: test the same account in Nextcloud. With MFA use an app password.
  Twenty login requests per IP or account in fifteen minutes trigger rate limiting;
  users behind the same tunnel/proxy share that IP limit.
- `Untrusted domain`: rerun `start-ui.sh` after the base stack is healthy; it adds
  the internal `app` hostname used by the API.
- Permission denied: check the share in Nextcloud. Controls reflect DAV permissions,
  but Nextcloud always makes the final authorization decision.
- `412` conflict: refresh the folder. Another user may have changed the file or
  the requested destination already exists. Upload/download again deliberately.
- Some corporate setups restrict share recipient search; only allowed users/groups
  will be returned. Verify file sharing and version apps are enabled.

After stopping the add-on, the original Nextcloud UI is still usable. For an
optional rollback, remove `app` from trusted domains only after the add-on is
stopped and after verifying no other client uses that hostname. Do not delete
`/srv/nextcloud` or the original secrets.

## Security and operational limits

This build targets your existing single-VM SSH-tunnel lab. Browser-to-VM traffic
is encrypted by SSH. Docker traffic to Nextcloud is HTTP inside the VM. Never
publish port 8081 as plain HTTP on a public interface. For wider use, provision
private routing and HTTPS, set UI_ORIGIN to the HTTPS origin, set COOKIE_SECURE=true,
and confirm reverse proxy/TLS configuration before rollout.

Session tokens are random opaque HttpOnly, SameSite=Strict cookies. Nextcloud
credentials are held only in API process memory for up to eight hours (expired
entries are purged each minute); they are not returned to React, stored in browser
storage or written to a database. The login form necessarily sends the entered
credential once to the API, then clears the input. The API must be operated as a
trusted service because credentials exist in its memory. Logging out destroys the
session; it does not revoke a reusable app password. Revoke it in Nextcloud if needed.

State-changing calls require a matching Origin, custom request header and session
CSRF token. The API does not offer an arbitrary upstream URL or administrator proxy.
File paths are scoped to the resolved account ID; traversal segments are rejected.
Nextcloud performs authorization on all file, version and share operations.
Uploads stream rather than buffering an entire file. Existing-file uploads use
ETags to catch concurrent changes; new uploads use If-None-Match to prevent silent
overwrites. Share edit grants are 3 for files and 15 for folders, excluding resharing.

Sessions are deliberately in memory for one API container. Before scaling, design
an encrypted shared session store and revisit rate limiting. No external fonts,
analytics or third-party frontend scripts are loaded. Base image tags receive
updates; for release-level reproducibility record/pin Docker image digests too.

Your original backup script covers Nextcloud files, database and original deployment
settings. It does not include this add-on directory. Retain this source ZIP and
privately back up the add-on `.env`; no new persistent data volume is required.
Use the original Nextcloud recovery procedure for file data, then redeploy this UI.

## Local development and validation

Use Node 24 and npm:

```bash
npm ci
npm test
npm run build
```

The automated tests use a **simulated Nextcloud server**. They test our API adapter
and security boundaries, not the real Nextcloud implementation. For UI development
with synthetic data, explicitly run `node tests/preview-server.js`, then open
http://localhost:8081 and use `alice` / `test-app-password`. These credentials are
only for the local test fixture and are never enabled by the Docker deployment.
Do not deploy the preview server. Production Dockerfiles exclude tests.

For development against an actual Nextcloud instance, run the API with
NEXTCLOUD_URL configured on the server, then `npm run dev` in another terminal.
Do not put Nextcloud credentials in Vite variables or React source.

See `docs/validation.md` for checks run during preparation and remaining live gates.

## Source references

- [Nextcloud WebDAV operations](https://docs.nextcloud.com/server/latest/developer_manual/client_apis/WebDAV/basic.html)
- [Nextcloud file versions](https://docs.nextcloud.com/server/latest/developer_manual/client_apis/WebDAV/versions.html)
- [Nextcloud OCS sharing API](https://docs.nextcloud.com/server/latest/developer_manual/client_apis/OCS/ocs-share-api.html)
- [Nextcloud 33 OCS authentication overview](https://docs.nextcloud.com/server/33/developer_manual/client_apis/OCS/ocs-api-overview.html)

The existing stack selected Nextcloud 33. The adapter uses established DAV and OCS
operations; validate these against your running image and enabled apps using the
acceptance walkthrough. No automatic Nextcloud upgrade is performed.

For the optional browser smoke test, install Chromium with
`npx playwright install chromium`. Start `node tests/preview-server.js` in one
terminal, then run `npm run test:browser` in another. The test exercises real React
against the simulated API, captures screenshots in `test-artifacts`, and checks
mobile overflow and read-only controls. Use a fresh fixture process for each run.
The test fixture is intentionally localhost-only and unrelated to your live files.

Admin provisioning references: [users](https://docs.nextcloud.com/server/latest/admin_manual/configuration_user/instruction_set_for_users.html), [groups](https://docs.nextcloud.com/server/latest/admin_manual/configuration_user/instruction_set_for_groups.html).

For the new admin browser test, use a fresh fixture process and run `npm run test:admin-browser`. The local fixture administrator is `ncadmin` / `test-app-password` (test fixture only).
