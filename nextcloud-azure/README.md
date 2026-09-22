# Project 9 — Nextcloud on Azure

A compact demonstration deployment with Terraform, Ubuntu 24.04, Docker Compose,
Nextcloud 33 Apache, PostgreSQL 16, Redis 7 and a cron service.

**Status:** prepared configuration, not deployed. Bash syntax and structural checks
are recorded in docs/validation.md. Azure provisioning and live service tests remain
required. No subscription credentials are included.

## Architecture and boundaries

Browser → local port 8080 → encrypted SSH tunnel → VM loopback port 8080 → Nextcloud.
Nextcloud connects to PostgreSQL and Redis over a private Docker network. A cron
container runs background jobs against the same application files.

| Component | Configuration |
|---|---|
| Region | westus3 by default; all resources inherit the resource group location |
| VM | Standard_B2s, 2 vCPU / 4 GiB; small demonstration workload |
| Storage | 64 GiB managed OS disk; persistent bind directories under /srv/nextcloud |
| Inbound access | SSH destination port 22, source port *, from your public IPv4 /32 only |
| Web listener | 127.0.0.1:8080 on VM; no public web port |
| Database/cache | No host ports; isolated backend Docker network |
| Authentication | SSH keys for VM; separate Nextcloud user/group accounts |

The VM has a public IP for restricted SSH and outbound downloads. This is a
restricted-access lab, not a fully private enterprise network. For normal company
users, replace the tunnel with VPN/private routing, internal DNS and HTTPS using a
trusted certificate; scope the web NSG rule to approved internal subnets and update
Nextcloud trusted domains/proxy settings. End users should not receive VM SSH access.

Files, group sharing and version history work in the base stack. Real-time Office
co-editing requires a separately integrated Collabora/ONLYOFFICE service. Plain-text
collaboration depends on the enabled Nextcloud apps. Do not claim Office co-editing
as a completed acceptance test for this base project.

## 1. Prepare your Windows computer

Use PowerShell with Azure CLI, Terraform and Windows OpenSSH installed. Run:

```powershell
az version
terraform version
ssh -V
az login
az account list --output table
az account set --subscription "YOUR-SUBSCRIPTION-ID"
az account show --query "{name:name,id:id}" --output table
```

Create a dedicated key (keep the private key on your computer). If that filename
already exists, reuse the intended key or choose a new filename; do not overwrite it.

```powershell
ssh-keygen -t ed25519 -f "$HOME/.ssh/nextcloud_key"
```

Extract this project ZIP and open PowerShell in the extracted `nextcloud-azure`
folder. Confirm the Azure region/VM size is available for your subscription. Choose
non-overlapping VNet addresses if integrating with existing networks. The provided
Terraform creates a new resource group; it does not import previous lab resources.

## 2. Provision Azure

```powershell
cd terraform
Copy-Item terraform.tfvars.example terraform.tfvars
notepad terraform.tfvars
```

Set your subscription ID, region, public SSH key path and real public IPv4 address
with `/32`. The example `203.0.113.10/32` is documentation-only and must be replaced.
For Windows paths use forward slashes, for example `C:/Users/YourName/.ssh/nextcloud_key.pub`.
Check your public IPv4 in a browser or your network/router settings. A VPN may change it.

```powershell
terraform init
terraform fmt
terraform validate
terraform plan -out=nextcloud.tfplan
```

Review the plan: one VM, one managed OS disk and one public IP incur Azure charges.
No existing resources should be deleted or replaced. Then apply the reviewed plan:

```powershell
terraform apply nextcloud.tfplan
$vmIp = terraform output -raw public_ip
cd ..
```

Commit `.terraform.lock.hcl` after initialization for provider version reproducibility.
Keep state, plan files and `terraform.tfvars` private. For team use, move state to an
access-controlled Azure Storage backend with locking and versioning.

## 3. Upload and deploy

Copy only deployment files, not Terraform state or your private SSH key:

```powershell
ssh -i "$HOME/.ssh/nextcloud_key" "azureuser@$vmIp" "mkdir -p nextcloud-azure"
scp -i "$HOME/.ssh/nextcloud_key" compose.yaml .env.example "azureuser@${vmIp}:nextcloud-azure/"
scp -i "$HOME/.ssh/nextcloud_key" -r scripts "azureuser@${vmIp}:nextcloud-azure/"
ssh -i "$HOME/.ssh/nextcloud_key" "azureuser@$vmIp"
```

In the VM's Bash terminal:

```bash
sudo cloud-init status --wait
sudo mkdir -p /opt/nextcloud
sudo cp -a ~/nextcloud-azure/. /opt/nextcloud/
sudo chown -R root:root /opt/nextcloud
cd /opt/nextcloud
sudo bash scripts/install-docker.sh
sudo bash scripts/start.sh
sudo cat secrets/admin_password
```

The default Nextcloud administrator is `ncadmin`. Save its generated password in
your password manager. Do not paste it into chat, screenshots, commits or reports.
The setup can take several minutes. If initialization times out, inspect logs and
rerun `start.sh`; do not delete the existing database or secrets.

## 4. Open Nextcloud

In a separate local PowerShell window (substitute the VM IP if `$vmIp` is unset):

```powershell
ssh -i "$HOME/.ssh/nextcloud_key" -N -o ExitOnForwardFailure=yes -L 127.0.0.1:8080:127.0.0.1:8080 "azureuser@$vmIp"
```

Keep that window open and visit **http://localhost:8080** in your browser. A quiet,
connected SSH tunnel is normal. Login with the Nextcloud admin credentials.
The browser uses local HTTP; SSH encrypts the connection across the network.
Use the same local port 8080 consistently.

## 5. Demonstrate the business workflow

1. As administrator, create a group `Project-Team` and two standard users `alice`
   and `bob`; add both to the group. Give each a small quota, such as 1 GB.
2. Login as Alice and create a folder `Project-Alpha`; upload a sample document.
3. Share the folder with `Project-Team`. Initially enable editing for this demo.
4. Login as Bob in a separate browser profile. Open Shared with you and download
   the document. Modify it locally and upload it with the same name, replacing it.
5. Alice checks the latest file and its Versions panel; restore the earlier version
   if available. Version retention is governed by Nextcloud policy and free space.
6. Change the share to read-only. Confirm Bob can read but cannot change files.
7. Create a third user outside the group and confirm the folder is inaccessible.

These are ordinary user-owned shared folders, not the optional Team folders app.
Public-link sharing is disabled by the startup script. Capture screenshots without
passwords or private documents. Use synthetic files for the demonstration.

## 6. Operations

See [Operations](docs/operations.md) for backup, restore, upgrades, troubleshooting
and cleanup, and [Acceptance](docs/acceptance.md) for the evidence checklist.

## Source references

- [Microsoft: Terraform Linux VM quickstart](https://learn.microsoft.com/en-us/azure/virtual-machines/linux/quick-create-terraform)
- [Nextcloud container configuration](https://github.com/nextcloud/docker)
- [Nextcloud 33 system requirements](https://docs.nextcloud.com/server/33/admin_manual/installation/system_requirements.html)
- [Docker Engine installation on Ubuntu](https://docs.docker.com/engine/install/ubuntu/)

Image tags fix major versions but can advance to newer patch releases. After a
successful deployment, record image digests and pin `.env` image values to them
for repeatable approved releases. The Ubuntu image and Docker packages similarly
use the available release at deployment time; record installed versions.
