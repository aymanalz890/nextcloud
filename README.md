# Teamspace — Internal File Sharing on Azure

An internal file-sharing platform with a custom React interface,
Nextcloud backend, and Azure infrastructure provisioned using Terraform.

## Components

- nextcloud-azure/: Terraform, Docker Compose, deployment scripts,
  and operational documentation.
- teamspace-ui/: React frontend, API service, tests, and UI deployment scripts.

## Features

- File uploads, downloads, and folder organization
- Sharing with internal users and groups
- Read-only and edit permissions
- File version history and restoration
- User and group administration
- Repeatable infrastructure and application deployment

## Architecture

The React frontend communicates with the Teamspace API, which uses
Nextcloud's WebDAV and OCS APIs. Nextcloud stores files and uses
PostgreSQL and Redis. Services run in Docker on an Azure Linux VM.

The demonstration deployment uses an SSH tunnel for browser access.

## Setup

See:

- [Infrastructure and Nextcloud setup](nextcloud-azure/README.md)
- [Teamspace UI setup and tests](teamspace-ui/README.md)

Create local configuration from the supplied example files.
Credentials, Terraform state, and deployment-specific variables are
excluded from version control.

## Collaboration example

Ayman shares a project folder with a group containing Meshal.
Harun remains outside the group to verify access restrictions.
Members can download, edit locally, and upload new file versions.
