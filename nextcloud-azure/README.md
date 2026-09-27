# Nextcloud on Azure

Single-VM Nextcloud deployment provisioned with Terraform and operated
using Bash scripts and Docker Compose.

## Architecture

- Azure resource group, VNet, subnet, NSG, static public IP, and Linux VM
- Ubuntu 24.04 with Docker Engine and Docker Compose
- Nextcloud, PostgreSQL, Redis, and a background-job container
- Persistent application and database directories under `/srv/nextcloud`

SSH access is restricted to an administrator IPv4 address.
Nextcloud listens on VM loopback port `8080` and is accessed through an SSH tunnel.
PostgreSQL and Redis have no published host ports.

## Prerequisites

- Azure subscription and authenticated Azure CLI
- Terraform >= 1.6 and < 2.0
- SSH key pair
- Bash-compatible shell; Windows Git Bash is supported

## Provision Infrastructure

From this project directory:

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
```

Set your subscription ID, region, available VM size, SSH public-key path,
and current administrator public IPv4 address with a `/32` suffix.

```bash
az login
terraform init
terraform plan -out=nextcloud.tfplan
terraform apply nextcloud.tfplan
```

Retrieve the VM address:

```bash
terraform output -raw public_ip
```

The intended demo VM size is `Standard_D2ls_v7`; availability depends on
the subscription and region.

## Deploy Nextcloud

Copy `compose.yaml`, `.env.example`, and `scripts/` to `/opt/nextcloud`
on the VM.

Run on the VM:

```bash
sudo cloud-init status --wait
cd /opt/nextcloud
sudo bash scripts/install-docker.sh
sudo bash scripts/start.sh
```

Startup creates `.env` and generates database and administrator passwords
if this is a new installation.

The default administrator is `ncadmin`. Retrieve its password on the VM:

```bash
sudo cat /opt/nextcloud/secrets/admin_password
```

From your local machine:

```bash
ssh -i ~/.ssh/nextcloud_key -N \
  -L 127.0.0.1:8080:127.0.0.1:8080 azureuser@VM_PUBLIC_IP
```

Open **http://localhost:8080**.

For the custom React interface, deploy the sibling `teamspace-ui` project
after Nextcloud is running.

## Operations

Run from `/opt/nextcloud`:

```bash
sudo bash scripts/health.sh
sudo docker compose ps
sudo docker compose logs --tail=100 app db cron
sudo bash scripts/backup.sh
```

Backups are written to `/var/backups/nextcloud`. The backup process briefly
stops Nextcloud and includes the database, application files, configuration,
and secrets. Export completed backups off the VM.

See [docs/operations.md](docs/operations.md) for restore and troubleshooting
procedures, and [docs/acceptance.md](docs/acceptance.md) for acceptance checks.

## Security and Scope

- Keep `.env`, `secrets/`, Terraform state, saved plans, and local variable
  files out of Git.
- Update `admin_cidr` when your public IP changes.
- Preserve existing secrets when redeploying.
- This capstone uses one VM and SSH-tunnel access; it provides no high availability.
- VM deletion or Terraform destruction removes the OS disk containing live data.
  Export backups before teardown.