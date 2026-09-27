# RootRecord Service Recovery

## Purpose

This repository maintains a recoverable operational baseline for RootRecord services.

The objective is to preserve service continuity when the primary RootRecord environment is unavailable. It provides a controlled source of configuration, service definitions, and application state required to restore operations.

## Recovery Principles

- Source files are maintained in version control.
- Runtime-generated data is excluded unless explicitly required.
- Secrets, credentials, and local machine state are never committed.
- Services should be restored from the canonical repository layout.

## Network Globe

Network Globe is maintained as a recoverable service component.

Canonical application path:

    mirror/network-globe/network-globe/

Runtime application path:

    /home/ubuntu/network-globe/network-globe/

The service is managed through:

    network-globe.service

## Validation

Before restoring service operation:

1. Verify repository integrity.
2. Confirm application files match the canonical version.
3. Confirm required environment configuration exists.
4. Restart the service.
5. Verify service health.

## Repository Safety

Excluded:

- credentials
- private keys
- runtime caches
- generated telemetry
- local logs
- temporary state

Included:

- application source
- service definitions
- architecture documentation
- recovery procedures
