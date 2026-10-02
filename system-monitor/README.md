# Mainland system monitor (us-mainland-one)

Staged scaffold (desk 3 - RootRecord-US-Mainland-Two). **Not installed** on the live host by this work.

## Behavior

1. `collect.py` — CPU/mem/disk/load/uptime + key service health → `var/sysmon/handoff/`
2. `stream_send.py` — SSH NDJSON to Pacific `rr_db_stream_receive.py` (primary)
3. On success → delete local handoff (never accumulate)
4. If Pacific unreachable / stream disabled → `telegram_datapack.py` (zip → sendDocument)
5. After Telegram accept → purge local (Telegram is the free buffer; do not stack on Mainland)
6. `purge.sh` — hourly leftover wipe (no archives)

EcoFlow / `Energy/` never collected or streamed.

## Dry-run (desk)

```bash
RR_SYSMON_SOURCE_NODE=us-mainland-one ./system-monitor/collect.py
./system-monitor/stream_send.py --dry-run | head
./system-monitor/telegram_datapack.py --dry-run
./system-monitor/purge.sh
# full cycle (stream may be disabled → telegram):
./system-monitor/run-cycle.sh
```

## Config

- `config/sysmon-stream.yaml` — SSH target; keep `enabled: false` until Pacific receiver + key exist
- Env names: `RR_DATAPACK_SEND_BOT_TOKEN`, `RR_DATAPACK_CHAT_ID`, `RR_SYSMON_SSH_*` (see `config/sysmon.env.example`)

## Units (staged, not installed)

`systemd/ml1-sysmon.{service,timer}` → host checkout `/home/ubuntu/US-Mainland-Server`

## Pacific landing

- Primary path_rel: `System/metrics/ml1/host-last.json`
- Telegram pickup: Pacific `Communications/telegram/scripts/datapack-pickup.py`
