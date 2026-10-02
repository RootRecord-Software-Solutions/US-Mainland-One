# Root Record radio

This folder is the audio library on Mainland One. The station is one mix. Listeners do not pick tracks.

The public page is `https://www.rootrecord.cloud/radio`. It plays `https://radio.rootrecord.cloud/radio/live.mp3` and reads `https://radio.rootrecord.cloud/radio/now.json`. Cloudflare sends `radio.rootrecord.cloud` to `127.0.0.1:8092`. The encoder is ffmpeg `libmp3lame`, 128 kbps.

`audio/music/` is the Opus bed, 96 kbps, in git. `audio/chimes/` is the Hawaii `:00` and `:30` chimes. `audio/reports/` holds one `<report>_current.opus` per report and stays off git. Hawaii writes the WAV, then `Media/Voice/scripts/radio_push.py` replaces that one file over SSH. `RR_RADIO_PUSH=0` turns the send off. The default is on.

The mixer is `rr-radio-station.service`. It ducks the bed at Hawaii `HH:59:59` and `HH:29:59`, plays the chime, then every current report, longest first, then returns the bed to full. `rr-radio-watchdog.timer` starts that unit when it is down and restarts it only when `state/heartbeat` is older than 30 seconds. Leave `rr-radio-stream.service` and `rr-radio-watch.timer` masked.

The operator guide is Library `Documentation/01-Operations/2026-10-01-radio-station.md`.
