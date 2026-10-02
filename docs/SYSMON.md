# System monitor — us-mainland-one

Staged 2026-10-02. Live install **not done**.

## Paths

| Piece | Path |
| --- | --- |
| Collect / send / purge | `system-monitor/` |
| Scratch (gitignored) | `var/sysmon/{handoff,state,telegram-outbox}/` |
| Stream config | `config/sysmon-stream.yaml` (`enabled: false`) |
| Units | `systemd/ml1-sysmon.{service,timer}` |

## Primary path

SSH NDJSON → Pacific `System/scripts/rr_db_stream_receive.py` → Database `System/metrics/ml1/host-last.json` (overwrite last) and optional Daily JSONL on home.

Contract mirrors ML2 `docs/SSH-STREAM-CONTRACT.md` with allowlist prefixes `System/metrics/ml1|ml2/`, `Logs/ML1|ML2/`, `Intake/ml1|ml2/`.

## Fallback — Telegram datapack

When SSH fails or stream is disabled, `telegram_datapack.py` zips handoff → `sendDocument` on the **datapack bot** (`RR_DATAPACK_*`). After API accept, Mainland deletes handoff + zip. **Do not stack** on Mainland; Telegram is the free buffer until Pacific `datapack-pickup.py` drains into Database.

Reference (historical only): ML1 REBUILD OLD FILES `rr-packer.service`, `ssh-datapack-pull.sh`, `RR_DATAPACK_*` in `.env.example`.

## EcoFlow

Pacific-only. This monitor never reads or writes `Energy/`.
