# US-Mainland-Server

> **Continuity / secondary node.** Canonical ops authority is the **org**.

> **Authority:** [RootRecord-Software-Solutions](https://github.com/RootRecord-Software-Solutions)  
> **Live Pacific:** [RootRecord-Pacific-Solar-Server](https://github.com/RootRecord-Software-Solutions/RootRecord-Pacific-Solar-Server)  
> **Docs index:** [MIGRATION-DOCS-INDEX](https://github.com/RootRecord-Software-Solutions/RootRecord-Library/blob/main/Documentation/04-Migration-and-Legacy-Recovery/MIGRATION-DOCS-INDEX-2026-09-28.md)  
> **Library:** [RootRecord-Library](https://github.com/RootRecord-Software-Solutions/RootRecord-Library)  
> **Database:** [RootRecord-Database](https://github.com/RootRecord-Software-Solutions/RootRecord-Database)

Secondary infrastructure node for service continuity, synchronization, and recovery. Prefer org Pacific as primary autonomous node documentation.

*Transition banner 2026-09-28 HST.*

---

## Desk checkout layout (G3, 2026-09-29 HST)

Desk path: `/home/rootrecord/RootRecord-Ecosystem/1 - Servers/2 - RootRecord-US-Mainland-Server/` (sibling of Pacific).
AWS path: `/home/ubuntu/US-Mainland-Server/` — the AWS `rr-rootserver-poller` `github_pull` job fast-forwards it **every minute**, so anything pushed here reaches the host's checkout within ~60 s (runtime copies under `/home/ubuntu/{automations,network-globe}` are deployed separately).

| Folder (current, lowercase — kept because AWS paths and docs reference it) | Proposed G3 Title-case name | What it holds | Runs on |
| --- | --- | --- | --- |
| `automations/` | `Automations/` | `rr-rootserver-poller.service` + 1 s poller + `jobs.py` (system monitor, comms polls, public IP notify, git pull) | AWS (as root) |
| `communications/` | `Communications/` | Telegram / Discord / Slack 1 s poll lanes; `.env.example` (destination IDs) | AWS |
| `system-monitor/` | `System/Monitor/` | `sys-sample.sh` → `system-current.json` + SQLite rolling averages | AWS |
| `network-globe/` | `Network/Globe-Collector/` | Hawaii collector (`collector.js`, `telegram-relay.js`), `maintain-hawaii-feed.sh`, units | desk (Pacific copy is live) + AWS feed |
| `mirror/network-globe/` | `Network/Globe-Server/` | AWS globe server (`server.js`, `index.html`) + Cloudflare globe tunnel config | AWS |
| `mirror/rootrecord/` | `Collectors/Legacy-Units/` | 13 legacy `rr-*` hazard/radio/packer unit files (not running on AWS 2026-09-29) | AWS (parked) |
| `weather/` | `Weather/` | current-only NWS mirror (config, core, fetch, scheduler) | AWS (not running) |
| `scripts/` | `Github/` + `Scripts/` | desk-side pull helpers (`aws-sysmon-pull.sh`, `ssh-datapack-pull.sh`), G2 `jobs.py` template | desk |
| `references/`, `notes/`, `docs/` | `References/`, `Notes/`, `Docs/` | AWS pull timer, identity, packer notes, 2026-09-22 stopping point, avatar | — |

**No rename was done.** A Title-case move needs a coordinated AWS path change and sign-off (see Library `06-Domains-and-External-Systems/US-Mainland-Server.md`).
The empty `Communications/` folder is the pre-import desk placeholder (2026-09-27); it is not tracked by git and was left in place.

Secrets: real values only in `/home/ubuntu/.env` (AWS) — root `.env.example` lists variable **names only**; `.env` / `.env.*` are gitignored.
