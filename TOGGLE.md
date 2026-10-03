# ML1 toggle — YouTube-only public + jobs.py timing

**Canonical radio tree:** this directory (`US-Mainland-One`).  
**Public air:** YouTube only (`https://www.youtube.com/@rootmcnews`).  
**Public `radio.rootrecord.cloud` / `live.mp3`:** **OFF**.

Pacific and ML2 must **not** keep duplicate RadioRss poller scripts.

## Public vs private

| Path | State |
| --- | --- |
| YouTube live (RTMP from host) | **On** — public listeners |
| Mixer `127.0.0.1:8092` | **On** — private mix for YouTube / local ops |
| `RADIO_SERVE` | Default `0` → HTTP `live.mp3` returns **410** |
| Cloudflare `radio.rootrecord.cloud` | **Removed** from tunnel ingress |
| Cloudflare `ml1.rootrecord.cloud` | SSH only |

## Modes (`RR_RADIO_MODE`) — Pacific → ML1 library

| Mode | Behavior |
| --- | --- |
| `remote` | SSH/SCP to live ML1 host only (`RR_RADIO_SSH`, default `ml1`) |
| `local` | Write into desk `rootrecord-radio/` (ML1 down / not transmitting) |
| `auto` (default) | Try remote; on SSH failure fall back to local desk tree |

Pacific `Media/Voice/scripts/radio_push.py` owns this gate. Voice generate stays on Pacific.

## Timing — same layout as Pacific `jobs.py`

ML1 catalog: [`scripts/jobs.py`](../scripts/jobs.py)  
Runner: [`scripts/ml1-poller.py`](../scripts/ml1-poller.py) (unit `systemd/ml1-poller.service`, staged)

Same fields as Pacific: `id`, `enabled`, `at_minute`, `at_second`, `every_seconds`, `command`, `cwd`, `env`, HST, 5-second slots.

| Job id | Slot | Notes |
| --- | --- | --- |
| `air_chime_boundary` | `:00` / `:30` | Marker (mixer already ducks) |
| `expect_radio_push_window` | `:55:00` | Pacific push dependency |
| `radio_rss_poll` | `:55:35` | Gate `RR_RADIO_RSS=1` |
| `radio_news_update` | `:55:40` | Gate `RR_RADIO_NEWS=1` |
| `youtube_stills_metadata` | `:55:50` | Gate `RR_ML1_YOUTUBE_META=1` |

Playlist content refine is a later pass. Do not invent a different scheduler format.

## RadioRss (always this tree)

| Job | Command |
| --- | --- |
| `radio_rss_poll` | `scripts/run-radio-rss.sh poll` → Database `Media/RadioRss/` |
| `radio_news_update` | `vendor/RadioRss/scripts/rss_radio.py news-hour --speak` |

Pacific may still call these paths when its gates are on. Not part of ML2 `RR_LOCAL_DATA_POLL`.

## Fail-safe (ML1 host down / not transmitting)

1. Leave `RR_RADIO_MODE=auto` (or set `local`).
2. `radio_push` banks `*_current.opus` into `rootrecord-radio/audio/reports/`.
3. Run `./station.sh` from this desk folder for local mix (still `RADIO_SERVE=0` unless debugging).
4. RadioRss keeps running from this tree into `RR_DATABASE_ROOT`.

## Related

- Station: `./station.sh`, `rootrecord-radio/`, `status-api/` (`RADIO_SERVE`)
- Tunnel: `mirror/.cloudflared/config-globe.yml`
- Sysmon: `docs/SYSMON.md`
