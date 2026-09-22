# Validation record — 15 September 2026

## Passed during preparation

- Production React/Vite build.
- Node syntax checks and Bash syntax checks for all deployment scripts.
- Compose YAML structural checks: only web publishes a host port, bound to
  127.0.0.1:8081; API has no published port; existing network is external.
- Six Node test suites against a simulated Nextcloud server covering:
  - Canonical account identity, credentials staying server-side, cookie flags,
    missing sessions, rejected CSRF/origin requests, logout invalidation.
  - Path traversal rejection, literal special characters and unsafe XML rejection.
  - Folder creation, streamed upload/download, rename, delete, overwrite conflicts.
  - Read-only and nonmember errors returned by the upstream adapter.
  - User/group sharing, permission update, removal, rejected public share creation.
  - File ID resolution, listing/downloading/restoring versions and invalid revisions.
- Browser smoke test against the same simulated backend: sign in, browse, create
  folder, upload, download, rename, view/restore version, search recipient, share,
  change permission, sign out, and read-only controls.
- Desktop and 390px mobile screenshots inspected; hidden upload input and mobile
  overflow issues were corrected. No browser page errors in the completed run.
- npm audit for production dependencies reported zero vulnerabilities at check time.

Browser screenshots under this directory show **synthetic test data**, not the
user's Azure files. A portable Chromium executable was used for this environment;
normal development uses Playwright's installed Chromium.

## Still required on the live deployment

Docker is unavailable in the preparation environment, so Docker image builds,
nginx runtime behavior and actual Compose startup were not executed here. The
production bundle was compiled with npm directly. Tests exercise the adapter with
mocked Nextcloud behavior; they do not prove live Nextcloud compatibility.

Run start-ui.sh and the README acceptance walkthrough on the existing VM. Verify
trusted domains, app-password login, permissions for three real test accounts,
recipient discovery, Nextcloud version behavior, downloads, and persisted data.
Review browser DevTools and container logs for deployment-specific errors.
No Azure or live Nextcloud changes were made during preparation.


## Users & Groups update (version 1.1.0)

Passed: production React build, nine API test cases including the original six,
Bash syntax checks for install/update scripts, and a new Chromium browser test.
The new tests cover creating users/groups, adding/removing members, disabling and
re-enabling accounts, invalidating disabled users’ sessions, server-side rejection
of ordinary users, revocation of admin rights during a session, CSRF checks,
protected admin accounts/group, pagination, path validation, duplicate errors and
creation-field allowlisting. No initial passwords are returned in API responses.

Browser checks passed for the complete admin flow, visible duplicate-name error,
non-admin menu/API denial and 390px mobile layout, with no page errors. Desktop and
mobile screenshots were inspected. New screenshots show synthetic test accounts.
These checks use the local simulated Nextcloud server, not the live Azure VM.

The update installer saves a private archive of the previous UI code/configuration,
preserves .env, and rebuilds only the Teamspace Compose project. Docker is not
available here, so live container build/restart and actual Nextcloud provisioning
remain to be verified using UPDATE.md on the VM. No live accounts were changed.
