# Teamspace on Azure

A React file-sharing dashboard backed by Nextcloud and deployed on a single Azure VM.

Teamspace provides file management, folder organization, sharing, version history, and user/group administration through a custom web interface.

This repository is intended for a **fresh deployment** and does not include a migration workflow.

## Stack

| Component | Role |
|---|---|
| React + Nginx | Frontend and reverse proxy |
| Express | Sessions and Nextcloud API integration |
| Nextcloud | Files, users, groups, sharing, and versions |
| PostgreSQL / Redis | Database, caching, and file locking |
| Terraform / Docker Compose | Azure provisioning and deployment |

## Features

- Upload, download, rename, move, and delete files
- Folder creation and organization
- User and group sharing
- Read-only and editable shares
- File version history
- User and group administration
- Group deletion with protection for the built-in `admin` group

## Deployment

### Prerequisites

- Azure subscription
- Azure CLI
- Terraform >= 1.6 and < 2.0
- SSH key pair:
  - `~/.ssh/nextcloud_key`
  - `~/.ssh/nextcloud_key.pub`

Windows Git Bash is supported.

### 1. Provision Azure infrastructure

```bash
az login

cd terraform
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars` with your Azure subscription, region, VM size, SSH key path, and administrator public IP.

```bash
terraform init
terraform plan -out=nextcloud.tfplan
terraform apply nextcloud.tfplan

vm_ip=$(terraform output -raw public_ip)
cd ..
```

### 2. Upload the project

From the project root:

```bash
upload_dir=$(ssh -i ~/.ssh/nextcloud_key azureuser@"$vm_ip" \
  'mktemp -d ~/teamspace.XXXXXX')

set -o pipefail

tar --exclude=.git \
  --exclude=node_modules \
  --exclude=dist \
  --exclude=.env \
  --exclude=secrets \
  --exclude=.terraform \
  --exclude='*.tfstate*' \
  --exclude='*.tfplan' \
  --exclude='*.tfvars' \
  --exclude='*.tfvars.json' \
  --exclude=test-artifacts \
  -czf - . |
ssh -i ~/.ssh/nextcloud_key azureuser@"$vm_ip" \
  "tar -xzf - -C '$upload_dir'"
```

Install the uploaded release:

```bash
ssh -i ~/.ssh/nextcloud_key azureuser@"$vm_ip" \
  "sudo mkdir -p /opt/teamspace && \
   sudo cp -a '$upload_dir/.' /opt/teamspace/ && \
   sudo chown -R root:root /opt/teamspace"
```

### 3. Configure and deploy

Connect to the VM:

```bash
ssh -i ~/.ssh/nextcloud_key azureuser@"$vm_ip"
```

Then run:

```bash
sudo cloud-init status --wait

cd /opt/teamspace

sudo bash scripts/install-docker.sh
sudo cp .env.example .env
sudo nano .env
```

Set:

```text
UI_ORIGIN=http://VM_PUBLIC_IP:8081
```

Then deploy:

```bash
sudo bash scripts/manage.sh deploy
```

Retrieve the generated administrator password:

```bash
sudo cat secrets/admin_password
```

Open:

```text
http://VM_PUBLIC_IP:8081
```

Sign in with:

```text
Username: ncadmin
Password: generated password
```

Database and administrator passwords are generated automatically on the first deployment and stored under:

```text
/opt/teamspace/secrets/
```

## Operations

Run from `/opt/teamspace`:

| Action | Command |
|---|---|
| Check services | `sudo bash scripts/manage.sh status` |
| View logs | `sudo docker compose logs --tail=100 -f` |
| Create backup | `sudo bash scripts/manage.sh backup` |
| Stop services | `sudo bash scripts/manage.sh stop` |
| Deploy/rebuild | `sudo bash scripts/manage.sh deploy` |

Persistent Nextcloud data is stored under:

```text
/srv/nextcloud
```

Backups are stored under:

```text
/var/backups/teamspace
```

## Tests

Requires Node.js 22 or later.

```bash
npm ci
npm test
npm run build
```

## Notes

- Port `8081` uses HTTP for demonstration purposes.
- Add HTTPS before using real credentials or sensitive files.
- SSH access is restricted to the administrator IP configured in Terraform.
- Keep `.env`, secrets, Terraform state, and local `.tfvars` files out of Git.
- Disabling a user is safer than deleting one when their files must be retained.
