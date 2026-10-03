# Radio toggle — one tree (ML1)

**Canonical radio + RadioRss:** this directory (`US-Mainland-One`).  
Pacific and ML2 must **not** keep duplicate RadioRss poller scripts.

## Modes (`RR_RADIO_MODE`)

| Mode | Behavior |
| --- | --- |
| `remote` | SSH/SCP to live ML1 host only (`RR_RADIO_SSH`, default `ml1`) |
| `local` | Write into desk `rootrecord-radio/` (ML1 down / not transmitting) |
| `auto` (default) | Try remote; on SSH failure fall back to local desk tree |

Pacific `Media/Voice/scripts/radio_push.py` owns this gate. Station fail-safe:

```bash
cd "/home/rootrecord/RootRecord-Ecosystem/1 - Servers/2 - RootRecord-US-Mainland-One"
./station.sh   # serves desk rootrecord-radio/ when the host is down
```

## RadioRss (always this tree)

Pacific jobs call **this checkout** (no Pacific/ML2 copies):

| Job | Command |
| --- | --- |
| `radio_rss_poll` | `scripts/run-radio-rss.sh poll` → Database `Media/RadioRss/` |
| `radio_news_update` | `vendor/RadioRss/scripts/rss_radio.py news-hour --speak` |

Gates: `RR_RADIO_RSS=1`, `RR_RADIO_NEWS=1`. Not part of ML2 `RR_LOCAL_DATA_POLL`.

## Fail-safe (ML1 host down / not transmitting)

1. Leave `RR_RADIO_MODE=auto` (or set `local`).
2. `radio_push` banks `*_current.opus` into `rootrecord-radio/audio/reports/`.
3. Run `./station.sh` from this desk folder for local air.
4. RadioRss keeps running from this tree into `RR_DATABASE_ROOT`.

Manual desk test:

```bash
./scripts/run-radio-rss.sh health
RR_RADIO_MODE=local python3 \
  "/home/rootrecord/RootRecord-Ecosystem/1 - Servers/1 - RootRecord-Pacific-Solar-Server/Media/Voice/scripts/radio_push.py" --all
```

## Related

- Station: `./station.sh`, `rootrecord-radio/`, `status-api/`
- Sysmon: `docs/SYSMON.md`
