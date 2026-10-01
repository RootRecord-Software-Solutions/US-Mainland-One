# fallback/: AWS fallback runtime (desk-canonical)

The desk is the main copy. AWS (`rr-aws-ip`, t3.micro, 908 MB) runs a **small fallback**: the globe, tunnel, a desk
watch and a relay buffer. It is not a full offload. Design: Library `08-ideas/2026-09-29-aws-fallback-rebuild.md`
(Phase 2 section). This folder is **not** in the desk auto-sync (the Mainland checkout stays uncommitted until the
`mainland` sync row is signed off).

| Path | What |
| --- | --- |
| `deploy-aws-fallback.sh` | one-way deploy: `--dry-run` (default) · `--apply` · `--apply --test-rollback` |
| `deploy/remote-activate.sh` | runs on AWS: lock → manifest verify → backup → flags (missing only) → system files → atomic `app` swap → apply plan must be "in sync" → timers → tick → health → rollback |
| `app/rr_fallback_tick.py` | one tick every 30 s (timer, **0 MB resident**): `desk_watch`, `relay_buffer` (+ `relay_send` sub-flag), `system_monitor`, status, daily retention, RAM/disk guard |
| `app/rr-fallback-apply` | ROOT (`/usr/local/sbin`): hard-coded id → unit map; applies service flags (path unit + 15-min reconcile timer) |
| `system/` | units, journald caps (`SystemMaxUse=100M`, `KeepFree=1G`, 14 days), logrotate (5 MB × 7) |
| `profile/` | `trimmed-micro.flags` (initial flags, only created if missing) and `budget.json` (floors 485 MB RAM / 1536 MB disk) |

## AWS layout

```text
~/rootrecord/fallback/
  app -> releases/<REL>/app      app.prev -> releases/<PREV>/app      releases/ (keep 5)
  flags/<id>  "1"|"0"            (Root Monitor "AWS Fallback" page writes these, with a dated backup)
  budget.json                    state/ (mode, desk_watch.json, last.json, mem_history.json, desk-heartbeat, desk-ack.json)
  spool/<source>/<YYYYMMDD-HH>.ndjson   spool/outbox/rr-aws-YYYYMMDD-HHMM-<pack_seq>.zip (manifest.json inside)
  data/current/status.json  system_monitor.json      logs/events.log  logs/deploy.log
```

- **Modes:** NORMAL, then SUSPECT (no desk signal for 120 s), then FALLBACK (300 s). Back to NORMAL after 3 fresh ticks. The signals are the `hawaii.ndjson` mtime (the desk streams it) and `state/desk-heartbeat` (the desk job, pending).
- **Relay:** in FALLBACK, AWS spools `aws_mode` and `aws_status` (5-min) envelopes `{id=sha256(source|key), source, observed_at, collected_by:"aws", seq, payload}`. Every 15 min they are packed into an outbox zip. Sending to the Data Relay needs `flags/relay_send=1` (**pending sign-off**). The desk acks by writing `state/desk-ack.json {"pack_seq": N}`, and AWS then prunes up to N. The hard cap is 256 MB, oldest first.
- **Guard:** a function runs only if `MemAvailable − ram_mb ≥ ram_floor_mb` and disk free is at least `disk_floor_mb`. Otherwise the result is `BUDGET_SKIP`, and the function is retried on the next tick.

## Re-enable / undo (all reversible)

| What | Undo |
| --- | --- |
| legacy pollers | set flag `github_poller` / `legacy_poller` to 1 in Root Monitor (apply runs `systemctl enable --now`), or `sudo systemctl enable --now github-poller.service rr-rootserver-poller.service` |
| OS trims | `sudo systemctl unmask fwupd.service udisks2.service ModemManager.service && sudo systemctl enable --now ModemManager.service udisks2.service multipathd.service fwupd-refresh.timer networkd-dispatcher.service unattended-upgrades.service` (fwupd is static and D-Bus-activated after unmask) |
| fallback runtime | `sudo systemctl disable --now rr-fallback-runner.timer rr-fallback-apply.path rr-fallback-apply.timer` (the globe keeps running) |
| a bad release | `./deploy-aws-fallback.sh --apply` with the fixed tree; or on AWS: `ln -sfn "$(readlink ~/rootrecord/fallback/app.prev)" ~/rootrecord/fallback/app.tmp && mv -T ~/rootrecord/fallback/app.tmp ~/rootrecord/fallback/app` |
| journald / logrotate caps | `sudo rm /etc/systemd/journald.conf.d/60-rootrecord-caps.conf && sudo systemctl restart systemd-journald`; `sudo rm /etc/logrotate.d/rootrecord-fallback` |
| history batching | restore `~/rootrecord/bin.bak-fallback-phase2-20260929-154333/connection-history.py`, then `sudo systemctl restart network-globe-connection-history` |
