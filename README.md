# US Mainland One (desk)

**YouTube broadcaster + private mixer + RadioRss.** Public `live.mp3` is off.

| Role | Path |
| --- | --- |
| Public air | YouTube (`@rootmcnews`) |
| Private mixer | `./station.sh` → `127.0.0.1:8092` (`RADIO_SERVE=0`) |
| Timing | `scripts/jobs.py` + `scripts/ml1-poller.py` (same EXACT_TIME layout as Pacific) |
| RadioRss | `vendor/RadioRss/` + `scripts/run-radio-rss.sh` |
| Toggle | `docs/TOGGLE.md` |

Pacific `radio_push.py` banks opus to the live host over SSH, or into desk `rootrecord-radio/audio/reports/` when ML1 is unreachable.
