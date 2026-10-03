# rootrecord-radio (private mixer)

Public listeners use **YouTube**, not this HTTP stream.

- Mixer binds `127.0.0.1:8092` (`HOST` / `PORT`).
- `RADIO_SERVE` defaults off → `GET /radio/live.mp3` returns **410**.
- Cloudflare hostname `radio.rootrecord.cloud` is removed from the Mainland-One tunnel.
- The host YouTube encoder takes the private mix (PCM/pipe or local feed); do not re-publish `live.mp3`.

Now-playing / health stay local: `/radio/now.json`, `/health`.

See `../docs/TOGGLE.md`.
