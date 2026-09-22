# Acceptance evidence — to complete during execution

All live checks below are pending. Record date, result and screenshot/log reference.

| Check | Required evidence |
|---|---|
| Infrastructure | Successful terraform validate, reviewed plan, successful apply |
| Resource consistency | VM, NIC, IP and VNet share the selected region/resource group |
| Access controls | SSH succeeds from allowed IP; no external web/DB/cache access |
| Deployment automation | install-docker.sh and start.sh complete successfully |
| Services | app/db/redis healthy; cron running and lastcron advances |
| User workflow | Upload/download and shared-folder access as two standard users |
| Permissions | Read-only recipient cannot modify; nonmember cannot access |
| Versions | Replace sample file, inspect history and restore prior content |
| Persistence | Files and logins survive compose down/start and VM reboot |
| Recovery | Exported backup restored successfully on separate test VM |
| Documentation | Setup, remaining limitations and operational ownership reviewed |

The SSH tunnel demonstrates internal application access for a lab operator.
Business-user access via private networking and HTTPS is a separate rollout gate.
Office co-editing is a separate integration, not provided by the baseline stack.
