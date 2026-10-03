# US Mainland One (desk)

**Radio station + RadioRss** live here. Same fail-safe rule as ML2 collectors: if the host is down / not transmitting, Pacific works from this directory.

| Role | Path |
| --- | --- |
| Station | `./station.sh` → `rootrecord-radio/` |
| RadioRss | `vendor/RadioRss/` + `scripts/run-radio-rss.sh` |
| Toggle | `docs/TOGGLE.md` (`RR_RADIO_MODE` remote \| local \| auto) |
| Sysmon | `system-monitor/` — `docs/SYSMON.md` |

Pacific `radio_push.py` banks opus into the live host over SSH, or into desk `rootrecord-radio/audio/reports/` when ML1 is unreachable.
