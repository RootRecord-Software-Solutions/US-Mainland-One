---
name: us-mainland-one
description: >-
  OmniBook edit desk for US-Mainland-One (own GitHub repo). Pacific skills
  gitignores this folder. AWS pulls every 1m; OmniBook pushes every 5m.
---

# us-mainland-one

This folder **is** the `US-Mainland-One` git work tree.

| | |
|--|--|
| GitHub | `RootRecord-Software-Solutions/US-Mainland-One` |
| Push | automations poller → `github_sync_all` (300s) |
| AWS pull | every 60s — see `references/aws-git-pull.service` |
| Intake data | `2 - RootRecord-Database/Intake/` |
| Baks | `2 - RootRecord-Database/Github/` via Pacific `Github/scripts/bak-new.sh` |

**Not** on Solar-Pacific-RootRecord-Server (ignored in Pacific `.gitignore`).

Edit here → wait for sync (or `push-repo-once.sh mainland`). AWS only pulls.
