# Update your running Teamspace installation

This release adds **Users & Groups** inside Teamspace. You can create groups,
create ordinary user accounts, add/remove group members, and disable/enable
ordinary accounts. Sign in as `ncadmin` or another member of Nextcloud's `admin`
group. Everyone else continues to see the normal file interface.

The backend verifies current administrator membership with Nextcloud on **each**
admin request. Browser controls are not the authorization boundary. Administrator
accounts and membership of the `admin` group are protected from changes here.
No user/group deletion or administrator promotion/demotion is included.

## 1. Upload from Windows Git Bash

Download the updated `teamspace-ui.zip` and extract it to a new folder. Open a
**local Git Bash window in the extracted `teamspace-ui` folder**, where you see
`Dockerfile.api`, `compose.yaml`, and `UPDATE.md`. Do not run these upload commands
inside the VM. Use the VM's current IP if it differs from the example.

```bash
vm_ip=20.118.169.245
ssh -i ~/.ssh/nextcloud_key azureuser@"$vm_ip" 'mkdir -p teamspace-ui-update'
scp -i ~/.ssh/nextcloud_key -r . azureuser@"$vm_ip":teamspace-ui-update/
ssh -i ~/.ssh/nextcloud_key azureuser@"$vm_ip"
```

If SSH times out, compare your current IPv4 (`curl -4 --noproxy '*' https://api.ipify.org`)
with `admin_cidr` in the original Terraform settings and apply the updated rule.

## 2. Install the update inside the VM

These commands preserve your existing `.env` and save the previous application
source/configuration before updating. Only app source, build files, and scripts
are copied; `/srv/nextcloud`, secrets, and the original Compose project are untouched.

```bash
sudo bash ~/teamspace-ui-update/scripts/install-update.sh
```

The build may take several minutes. Rebuilding restarts the API, so existing
Teamspace sessions end. Nextcloud files, groups, shares and user accounts persist.
If the update fails, save the output and check `sudo docker compose logs --tail=100`.

## 3. Open the dashboard

Keep or reopen your **local Windows** tunnel:

```bash
ssh -i ~/.ssh/nextcloud_key -N -o ExitOnForwardFailure=yes \
  -L 127.0.0.1:8081:127.0.0.1:8081 azureuser@20.118.169.245
```

Open http://localhost:8081, refresh, then sign in again as `ncadmin`.
The sidebar now contains **Users & Groups**.

## 4. Create your team without opening Nextcloud's UI

1. Open **Users & Groups → Groups → Create group**. Enter `Project-Team`.
2. Open **Users → Create user**. Enter the username, display name, and an initial
   password of at least 12 characters. Email is optional. Nextcloud's own password
   policy still applies. Give the initial password to the user through a secure
   channel; this form does not send an invitation or force a password change.
3. Return to **Groups**, select `Project-Team`, and use **Find a user to add**.
   Select **Add** beside the correct account. Repeat for other teammates.
4. Open **All files**, select a file or folder, then **Sharing**. Search for
   `Project-Team`, select the group, choose its permission, and click **Share**.
5. Test in a separate browser profile with an ordinary user. They must not see
   **Users & Groups**. Confirm the shared folder appears and permissions work.

Removing a member can remove access obtained through that group; other direct
shares or other group memberships can still grant access. Disabling a user blocks
sign-in without deleting their files; enabling restores sign-in. Existing sessions
for a user disabled through Teamspace are removed immediately.

## Rollback

If necessary, stop only Teamspace with `sudo docker compose down` from
`/opt/nextcloud/teamspace-ui`. Move the failed source directory aside, extract the
chosen code backup under `/opt/nextcloud`, then run `sudo bash scripts/start-ui.sh`
inside the restored directory. This rolls back application code only. Accounts,
groups and membership changes already made in Nextcloud remain in effect.

## Validation and limits

See `docs/validation.md`. Automated tests use a simulated Nextcloud server; run
this walkthrough on your VM to verify the provisioning APIs with your enabled apps
and account directory. Read-only external user/group directories may reject edits.
Full administrators are supported; delegated group subadministrators are not.
Groups and users are paginated and searchable; the member list comes from Nextcloud.

This update does not add SMTP setup, password reset, MFA enrollment, server-wide
configuration or administrator-role management. Those advanced settings remain
outside this Teamspace page.
