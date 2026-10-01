# Root Record radio

The public page is `https://www.rootrecord.cloud/radio`. This folder is the audio library on the Mainland host. The page does not hold the files.

`audio/music/` is the shuffle bed. Live voice reports are not stored in this checkout. They sit at `/home/ubuntu/rootrecord-radio/audio/reports/` on the Mainland host, one `<report>_current.ogg` per report. A new render replaces that file and removes every other name in that folder. Nothing here is fetched from Hawaiʻi.

Hawaiʻi still writes the WAV, then `Media/Voice/scripts/radio_push.py` encodes it and replaces that one file over SSH (`rr-aws-ip`). `RR_RADIO_PUSH=0` turns the send off. The default is on. The music library is sent the same direction, once, with `radio_push.py --music`. That copy does not delete remote files and does not download.

The status API serves the library:

- `GET /radio/catalog.json`
- `GET /radio/music/<file>.mp3`
- `GET /radio/reports/<report>_current.ogg`

`RADIO_DIR` is the live library (`/home/ubuntu/rootrecord-radio/audio`). `RADIO_REPORTS_DIR` is its `reports` folder. Music stays a symlink back to `audio/music/` in this checkout.

The catalog lists a rollup only inside its Hawaii window: morning 09:00–12:00, midday 12:00–21:00, late 21:00–09:00. The file stays on disk. After noon the morning report is not offered to the player.
