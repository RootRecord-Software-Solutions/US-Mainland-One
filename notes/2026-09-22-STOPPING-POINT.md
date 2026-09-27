# US-MAINLAND-SERVER — STOPPING POINT (for tomorrow-me)
**Stopped:** 2026-09-22 18:40:33 HST  
**Power context:** Operator on emergency Wh; clean stop overnight.

## Live confirm at stop
```
desk_hawaii=active
packer=active
sshflag=Environment=RR_SSH_DATAPACK=0
locations=4108
disk=89% 772M
wipe={ "at": "2026-09-22T18:40:07.238271-10:00", "ok": true}
```

## Clean stop — no mid-deploy left open
Finished tonight:
1. Emergency disk: hawaii.ndjson truncated ~8MB + offset reset; disk ~89%
2. Packer **Telegram-only** drop-in `RR_SSH_DATAPACK=0` (until SSH-first returns)
3. Deployed `collect_locations.py` (was missing/empty) — smoke 101 lines in work/locations/
4. FULL resume + emergency docs in handoff; worklog updated

## Do NOT redo
- Hawaii unit path fix (coms/ssh/local-data-globe) — already good if active
- Soft-park rr-ingest / aws-sync OFFLOADED / rclone *.OFFLOADED
- GitHub SSH remotes + identity commits
- NETWORK folder layout (writers still deferred)

## Resume order (tomorrow)
1. Power stable + OmniBook up; `ssh rr-aws` OK
2. Confirm disk %, telegram-only still intended or clear to re-enable SSH-first
3. Retarget `ssh-datapack-pull.sh` → `Database/NETWORK/datapacks/`
4. Ping Bruce before any pack-slot / 5m timer; EcoFlow+OmniBook metrics → NETWORK
5. Deploy missing NETWORK landers (locations extract + aws sysmon copy)
6. Only then remove telegram-only drop-in if SSH-first ready (Carly already sealed draft)
7. Push as US-MAINLAND-SERVER

## Key docs
- `US-MAINLAND-SERVER-FULL-RESUME-2026-09-22.md` (§C left / §H disk / §I collect_locations)
- `US-MAINLAND-SERVER/US-MAINLAND-WORKLOG.md`
- Staging: `staging area/lanes/us-mainland/PACKER-SSH-FIRST-DRAFT-20260922.md`

## Walls
Stripe → Carly | council → Bruce | public wording → Ava | no vendor-name clutter in docs

Night — keep the watts.
