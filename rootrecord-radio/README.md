# Root Record radio

The public page is `https://www.rootrecord.cloud/radio`. Listeners use `https://radio.rootrecord.cloud/radio/live.mp3` and `https://radio.rootrecord.cloud/radio/now.json`. Caddy on Mainland One sends those two paths to `127.0.0.1:8092`. This folder is the audio library on the Mainland host. The page does not hold the files.

`audio/music/` is the shuffle bed. Live voice reports sit in `audio/reports/` inside this runtime, one `<report>_current.opus` per report. A new render replaces that file and removes every other name in that folder. Nothing here is fetched from Hawaiʻi.

Hawaiʻi still writes the WAV, then `Media/Voice/scripts/radio_push.py` encodes it and replaces that one file over SSH (`rr-aws-ip`). `RR_RADIO_PUSH=0` turns the send off. The default is on. The music library is sent the same direction, once, with `radio_push.py --music`. That copy does not delete remote files and does not download.

The status API serves the library:

- `GET /radio/catalog.json`
- `GET /radio/music/<file>.opus`
- `GET /radio/reports/<report>_current.opus`
- `GET /radio/chimes/hour-HH-MM.opus` — Hawaii :00 and :30. The page pauses a report, plays this file, then continues the report.

`RADIO_DIR` is `audio/` in this runtime. `RADIO_REPORTS_DIR` is `audio/reports/`. Music is `audio/music/`.

The catalog lists a rollup only inside its Hawaii window: morning 09:00–12:00, midday 12:00–21:00, late 21:00–09:00. The file stays on disk. After noon the morning report is not offered to the player.

A play is a GET that starts at byte 0 and sends more than 1024 bytes. Those lines go to `plays.log` in this runtime (`time`, kind, filename, bytes). `rr-radio-plays-purge.timer` empties that file every hour. It does not keep a copy.

`rr-radio-stream.service` is the station. One process mixes the music, the reports, and the Hawaii chimes into one MP3. Listeners join `GET /radio/live.mp3`. `GET /radio/now.json` is the current music and report. During a chime that field is `Time`. A browser does not choose or skip a track.

The live engine is the release at `active/`, started by `radio-run.sh` from this runtime. A git pull stages a new release and writes `deploy-pending`. It does not restart the station. The engine switches only when no report and no chime are in progress, by exiting 75. `rr-radio-watch.timer` starts the unit if it is down, and restarts it only when `state/heartbeat` is older than 30 seconds. A new report is not a failure. The last check is `watch.json` beside the engine.

A report plays from the `*_current.opus` inode ffmpeg opened. A replacement published with `mv` waits until that inode finishes. A `:00` or `:30` chime holds that decoder and resumes the same samples. The slot key includes the Hawaii date, so the same minute can fire again the next day. Music stays open underneath both.
