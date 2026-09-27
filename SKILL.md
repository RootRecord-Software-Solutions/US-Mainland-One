---
name: us-mainland-server
description: >-
  OmniBook edit desk for US-Mainland-Server (own GitHub repo). Pacific skills
  gitignores this folder. AWS pulls every 1m; OmniBook pushes every 5m.
---

# us-mainland-server

This folder **is** the `US-Mainland-Server` git work tree.

| | |
|--|--|
| GitHub | `rootrecordsoftwaresolutions/US-Mainland-Server` |
| Push | automations poller → `github_sync_all` (300s) |
| AWS pull | every 60s — see `references/aws-git-pull.service` |
| Intake data | `/home/rootrecord/Database/intake/` |
| Baks | `/home/rootrecord/Database/GITHUB/` via `../github/scripts/bak-new.sh` |

**Not** on Solar-Pacific-RootRecord-Server (ignored in Pacific `.gitignore`).

Edit here → wait for sync (or `push-repo-once.sh mainland`). AWS only pulls.
