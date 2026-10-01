# Root Record radio

The public page is `https://www.rootrecord.cloud/radio`. This folder is the audio library on the Mainland host. The page does not hold the files.

`audio/music/` is the shuffle bed. Live voice reports are not stored in this checkout. They sit at `/home/ubuntu/rootrecord-radio/audio/reports/` on the Mainland host, one `<report>_current.ogg` per report. A new render replaces that file and removes every other name in that folder. Nothing here is fetched from Hawaiʻi.

Hawaiʻi still writes the WAV, then `Media/Voice/scripts/radio_push.py` encodes it and replaces that one file over SSH (`rr-aws-ip`). `RR_RADIO_PUSH=0` turns the send off. The default is on. The music library is sent the same direction, once, with `radio_push.py --music`. That copy does not delete remote files and does not download.

The status API serves the library:

- `GET /radio/catalog.json`
- `GET /radio/music/<file>.mp3`
- `GET /radio/reports/<report>_current.ogg`
- `GET /radio/chimes/hour-HH-MM.wav` — Hawaii :00 and :30. The page pauses a report, plays this file, then continues the report.

`RADIO_DIR` is the live library (`/home/ubuntu/rootrecord-radio/audio`). `RADIO_REPORTS_DIR` is its `reports` folder. Music stays a symlink back to `audio/music/` in this checkout.

The catalog lists a rollup only inside its Hawaii window: morning 09:00–12:00, midday 12:00–21:00, late 21:00–09:00. The file stays on disk. After noon the morning report is not offered to the player.

A play is a GET that starts at byte 0 and sends more than 1024 bytes. Those lines go to `/home/ubuntu/rootrecord-radio/plays.log` (`time`, kind, filename, bytes). `rr-radio-plays-purge.timer` empties that file every hour. It does not keep a copy.

`rr-radio-stream.service` is the station. One process mixes the music, the reports, and the Hawaii chimes into one MP3. Listeners join `GET /radio/live.mp3`. `GET /radio/now.json` is the current music and report. A browser does not choose or skip a track. `rr-radio-watch.timer` keeps that service, the status API, and Caddy as one process each. A healthy process is not restarted. The live mixer is `/home/ubuntu/rootrecord-radio/stream.js`. The last check is `watch.json` beside it.
