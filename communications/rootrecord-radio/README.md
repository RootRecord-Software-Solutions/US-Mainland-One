# Root Record radio

The public page is `https://www.rootrecord.cloud/radio`. This folder is the audio library on the Mainland host. The page does not hold the files.

`audio/music/` is the shuffle bed. `audio/reports/` holds one `*_current.ogg` per voice report. A new render replaces that file. Nothing here is fetched from Hawaiʻi.

Hawaiʻi still writes the WAV, then `Media/Voice/scripts/radio_push.py` encodes it and sends that one file over SSH (`rr-aws-ip`). `RR_RADIO_PUSH=0` turns the send off. The default is on. The music library is sent the same direction, once, with `radio_push.py --music`. That copy does not delete remote files and does not download.

The status API serves the library:

- `GET /radio/catalog.json`
- `GET /radio/music/<file>.mp3`
- `GET /radio/reports/<report>_current.ogg`

`RADIO_DIR` overrides the audio folder. The service file points it at this directory on the host.
