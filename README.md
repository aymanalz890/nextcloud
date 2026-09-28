# Teamspace on Azure

A React file-sharing dashboard backed by Nextcloud, running on a single Azure VM.

Supports file uploads, folder organization, team sharing, version history,
and user/group administration.

## Stack

| Component | Role |
|---|---|
| React + Nginx | Frontend and API reverse proxy |
| Express | Sessions and WebDAV/OCS integration |
| Nextcloud | Files, accounts, permissions, and background jobs |
| PostgreSQL / Redis | Metadata / caching and file locking |
| Terraform / Docker Compose | Azure infrastructure and container orchestration |

## Deployment

### Prerequisites

- Azure subscription and Azure CLI
- Terraform >= 1.6 and < 2.0
- SSH key pair at `~/.ssh/nextcloud_key` and `~/.ssh/nextcloud_key.pub`

Run local commands from the project root. Windows Git Bash is supported.

### 1. Provision infrastructure

```bash
az login
cd terraform
cp terraform.tfvars.example terraform.tfvars
```

Edit `terraform.tfvars` with your subscription ID, region, VM size,
SSH public-key path, and administrator public IP followed by `/32`.

```bash
terraform init
terraform plan -out=nextcloud.tfplan
terraform apply nextcloud.tfplan
vm_ip=$(terraform output -raw public_ip)
cd ..
```

### 2. Upload the project

Run on your local computer:

```bash
upload_dir=$(ssh -i ~/.ssh/nextcloud_key azureuser@"$vm_ip" \
  'mktemp -d ~/teamspace-release.XXXXXX')

set -o pipefail

tar --exclude=.git --exclude=node_modules --exclude=dist \
  --exclude=.env --exclude=secrets --exclude=.terraform \
  --exclude='*.tfstate*' --exclude='*.tfplan' \
  --exclude='*.tfvars' --exclude='*.tfvars.json' \
  --exclude=test-artifacts -czf - . |
ssh -i ~/.ssh/nextcloud_key azureuser@"$vm_ip" \
  "tar -xzf - -C '$upload_dir'"
```

After the upload succeeds:

```bash
ssh -i ~/.ssh/nextcloud_key azureuser@"$vm_ip" \
  "sudo mkdir -p /opt/teamspace && sudo cp -a '$upload_dir/.' /opt/teamspace/ && sudo chown -R root:root /opt/teamspace"
```

### 3. Configure and start

Connect to the VM:

```bash
ssh -i ~/.ssh/nextcloud_key azureuser@"$vm_ip"
```

Run the following inside the VM:

```bash
sudo cloud-init status --wait
cd /opt/teamspace
sudo bash scripts/install-docker.sh
sudo cp .env.example .env
sudo nano .env
```

Set `UI_ORIGIN` to `http://VM_PUBLIC_IP:8081`, replacing
`VM_PUBLIC_IP` with your VM's address.

```bash
sudo bash scripts/manage.sh deploy
sudo cat secrets/admin_password
```

Open `http://VM_PUBLIC_IP:8081`. Sign in as `ncadmin` using the
generated password, then create ordinary accounts for other users.

## Operations

Run inside the VM from `/opt/teamspace`:

| Action | Command |
|---|---|
| Check services | `sudo bash scripts/manage.sh status` |
| View logs | `sudo docker compose logs --tail=100 -f` |
| Create backup | `sudo bash scripts/manage.sh backup` |
| Stop services | `sudo bash scripts/manage.sh stop` |
| Build and start | `sudo bash scripts/manage.sh deploy` |

Files and database data persist under `/srv/nextcloud`.
Backups are stored under `/var/backups/teamspace`; copy completed
backups off the VM to protect against disk loss.

## Tests

Requires Node.js 22 or later.

```bash
npm ci
npm test
npm run build
```

API tests use a simulated Nextcloud backend. Verify sharing,
permissions, and version history against the deployed instance as well.

## Notes

- This demo exposes port 8081 over HTTP. Use disposable accounts and
  sample files; add HTTPS before handling real credentials or documents.
- SSH is restricted to the administrator IP configured in Terraform.
- Keep `.env`, secrets, and Terraform state out of Git.
- Deleting a user also deletes their owned files. Disable the account
  instead if its data needs to be retained.
- Document collaboration uses download, local editing, and reupload.
  Live browser-based document editing is not included.