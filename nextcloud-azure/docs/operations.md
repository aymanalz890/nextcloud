# Operations

Run VM commands from `/opt/nextcloud` with sudo. Docker access is equivalent to
root access; users need Nextcloud accounts, not membership of the docker group.

## Health and troubleshooting

```bash
sudo bash scripts/health.sh
sudo docker compose logs --tail=100 app db cron
sudo docker compose exec -u www-data app php occ status
sudo docker compose exec -u www-data app php occ config:app:get core lastcron
sudo docker compose exec -u www-data app php occ config:system:get backgroundjobs_mode
df -h /srv/nextcloud
sudo du -sh /srv/nextcloud/*
sudo systemctl status docker
```

- SSH timeout: verify VM running, public IP, your current source IPv4 /32 and NSG
  association. Ping can fail because ICMP is denied; that does not prove SSH is down.
- Local browser refuses connection: confirm tunnel remains open and port 8080 is
  free; inspect `docker compose ps` on the VM.
- Untrusted domain: access localhost:8080 as documented. Do not use wildcard
  trusted domains; explicitly configure a DNS name when changing the access design.
- Database authentication failure: preserve original secrets. Changing a password
  file after database creation does not change the database role password.
- Initial setup fails: inspect logs and disk capacity; retain data for diagnosis.
- Cron: confirm `lastcron` advances after at least five minutes. A running process
  alone is insufficient proof of successful background jobs.

## Backup

```bash
sudo bash scripts/backup.sh
```

The script stops app and cron to prevent writes, dumps PostgreSQL, archives the
entire Nextcloud directory (including config, files and apps), saves deployment
files/secrets and restarts services. Expect downtime proportional to data size.
A completed backup has a `COMPLETE` marker and SHA256SUMS. Check available disk
space first; the OS disk holds both live data and these temporary backups.

Copy completed backups off the VM to an access-controlled, encrypted backup
location. Same-VM backups do not protect against VM/disk loss. Backups contain
credentials and user data. Decide retention and recovery targets; an example for
a demonstration is daily backups, seven retained copies and a restore rehearsal.
Scheduling and off-VM backup storage are not provisioned by this starter.

## Restore rehearsal to a separate, fresh VM

Use a disposable VM with matching Docker images and enough disk space. Never run
this sequence over a populated installation. Restore the original database major
version and exact Nextcloud image digest; do not attempt an in-place downgrade.
Have the completed backup directory available as `/root/restore`.

```bash
cd /root/restore
sha256sum -c SHA256SUMS
test -f COMPLETE
sudo mkdir -p /opt/nextcloud /srv/nextcloud
# Both targets must be fresh/empty before extracting trusted backup archives.
sudo tar -xzf deployment.tar.gz -C /opt/nextcloud
sudo tar --numeric-owner -xzf html.tar.gz -C /srv/nextcloud
cd /opt/nextcloud
# Set .env images to the digests recorded for this backup before continuing.
sudo docker compose up -d --wait db redis
sudo docker compose exec -T db pg_restore -U nextcloud -d nextcloud \
  --no-owner --exit-on-error < /root/restore/database.dump
sudo bash scripts/start.sh
```

If pg_restore fails, stop and resolve it before starting Nextcloud; do not rerun
against a partially restored database. Recreate only the disposable test database
under a deliberate recovery procedure. Verify file download, permissions, versions,
cron and user login using an SSH tunnel to the new VM. Record achieved recovery time.

## Patching and upgrades

Ubuntu security updates are enabled by the install script. Monitor reboot needs
(`/var/run/reboot-required`), Docker updates and Nextcloud security releases.
Before upgrades: take and export a complete backup; test on a restore VM. Change
approved image pins in `.env`, then use `sudo docker compose pull` and
`sudo bash scripts/start.sh`. Upgrade Nextcloud one supported major version at a
time. PostgreSQL major upgrades require a separate migration; changing its image
tag is insufficient. To roll back a database-changing upgrade, restore a matched
pre-upgrade database and filesystem backup on matching images.

Configure monitoring for disk usage (alert at 80%), unhealthy services, failed
backups, login anomalies and cron age. Container logs have size limits. Review
Nextcloud Administration settings → Overview and document remaining warnings.
SMTP, MFA enrollment, quotas, retention, HTTPS/private routing and offsite backups
need operational decisions before company-wide use. There is no high availability;
this VM and its disk are a single failure domain.

## Stop, redeploy and remove

```bash
sudo bash scripts/stop.sh
sudo bash scripts/start.sh
```

Stopping containers retains `/srv/nextcloud` and all secrets. Restart policies
bring previously running services back after VM reboot; test this once. `down`
removes containers, so use `start.sh` after an intentional stop.

For lab teardown only, export and verify backups first. On your computer, from
`terraform`, run `terraform plan -destroy` and review it, then `terraform destroy`
only when ready. Destroying this deployment deletes the VM and its managed OS disk,
including live data and same-VM backups. Stopping the VM from inside Ubuntu does
not deallocate it. Azure deallocation can reduce compute cost; disks/public IP
may still incur charges. Never use teardown as a troubleshooting shortcut.
