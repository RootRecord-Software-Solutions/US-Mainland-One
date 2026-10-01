# Globe landing overlay (`overlay/`)

Added 2026-09-29 ~14:20–14:35 HST. The globe page stays a full-screen interactive globe, with glass cards over it: Sign up, Website Home and Live status. There's also an optional left rail. Vanilla JS/CSS with no dependencies, about 21 KB unminified.

Design doc: Library `Documentation/08-ideas/2026-09-29-globe-landing-overlay.md`. Test record: Library `Documentation/07-testing/2026-09-29-globe-landing-overlay-preview.md`.

## Files

| File | Deploy? | Purpose |
|---|---|---|
| `overlay.js` | yes | Builds the cards, stores close state in `localStorage` (`rr-globe-overlay:v1:*`) and polls the status endpoints |
| `overlay.css` | yes | Glass cards, restore dock, rail, mobile layout, compact legacy HUD |
| `overlay-config.json` | yes | All flags (below). Edit this file to change behaviour; no code edit needed |
| `preview-server.js` | **no** | Local preview on 127.0.0.1 with synthetic data |
| `sample-state.json` | **no** | Synthetic data for the preview only |
| `test/overlay.test.js` | **no** | jsdom unit/integration tests (v2): 16 cases, run in a scratch dir |

It hooks into the page with one line in `../index.html`: `<script src="/overlay/overlay.js" defer></script>`.
The mirror `../server.js` has an allowlisted route for exactly three paths: `/overlay/overlay.{js,css}` and `/overlay/overlay-config.json`.
The **AWS runtime** `server.js` is a different Express version. Its `express.static(__dirname)` already serves `overlay/`, so it needs no server change (see Deploy).

## Flags (`overlay-config.json`)

| Key | Default | Meaning |
|---|---|---|
| `enabled` | `true` | Master switch. `false` means the page is the plain globe again |
| `allowUrlOverrides` | `false` | When `true`, `?ov_rail= / ov_home= / ov_signup= / ov_status=` (`1` or `0`) and `?ov_reset=1` work. Keep this `false` in production |
| `rail.enabled` | `false` | Collapsible left nav rail |
| `rail.startCollapsed` | `true` | Rail opens narrow (icons only). The user's choice is then remembered |
| `legacyHud` | `"compact"` | Existing HUD panel: `keep`, `compact` (smaller on phones) or `hide` |
| `cards.signup.enabled` | `true` | Sign-up card |
| `cards.signup.mode` | `"placeholder"` | `placeholder` shows a clearly badged form that **submits nowhere**. `link` shows a button to `cards.signup.url` (it must start with `https://` or `/`) |
| `cards.signup.url` | Vercel `/login?next=/` | Used only when `mode` is `link`. Switch only after the goals auth API answers again |
| `cards.home.enabled` | `false` | **Keep this off until Vercel `/home` is routed.** `rootrecord.cloud` currently 301-redirects to `www`, which is this globe |
| `cards.home.url` | `https://rootrecord.cloud/home` | Website Home link |
| `cards.status.enabled` | `true` | Live status card |
| `cards.status.pollSec` | `15` | Poll interval (minimum 5). Polling pauses while the tab is hidden or the card is closed |
| `cards.status.healthUrls` | `["/healthz","/health"]` | The first one that returns JSON wins. The mirror server uses `/healthz`; the AWS runtime uses `/health` |
| `cards.status.stateUrl` | `/api/state` | The globe feed the page already polls |
| `cards.status.deskHealthUrl` | `null` | Optional **public, CORS-enabled JSON** desk health endpoint. Only `ok` or `status` is read. Do not point it at `rootserver…/health`, which is plain text and contains a filesystem path |
| `cards.status.staleSec` | `90` | Age at which `stats.updated` shows as stale (warn) |
| `globe.spinToggle` | `true` | **v2.** A `⏸ Stop spin` / `▶ Resume spin` button in the dock (plus a rail item) toggles `globe.controls().autoRotate`. The choice is remembered in `localStorage` as `rr-globe-overlay:v1:spin` |
| `globe.spinDefault` | `"on"` | Used when nothing is stored yet: `on`, `off`, or `auto` (off if the OS asks for reduced motion) |
| `globe.clickInfo` | `true` | **v2.** Clicking an arc or point opens a glass info card (location, network/ASN, public IP, protocol/port, traffic, flows, last seen in HST). It refreshes every 2 s. Close it with ×, Esc or a click on empty globe |
| `globe.pauseSpinWhileInfoOpen` | `true` | Rotation pauses while the info card is open and resumes on close. The stored preference is unchanged |
| `globe.hover` | `true` | Hover highlight: the arc or point turns amber and gets thicker/bigger. It is keyed by flow, so it survives the 1 s data refresh |
| `globe.showIp` | `true` | Show **public** remote IPs. Private/reserved IPs always show as "private (hidden)", and the Hawaiʻi desk-link IP as "hidden (desk link)" |
| `globe.showProcess` | `false` | Desk process names stay hidden (the page's own tooltip used to show them) |
| `globe.hardenTooltips` | `true` | Replaces the page's `arcLabel`/`pointLabel`, which build HTML from feed/geo strings, with escaped versions that follow the same hiding rules |
| `globe.stableData` | `true` | **Fix.** Reuses the same object for the same flow on each 1 s poll, so three-globe updates meshes in place instead of re-creating them and re-playing the 1 s grow-in (see below) |

The status card never renders `origin`, `hostname`, AWS `account`, paths or tokens, and all values go in through `textContent`. Runtime switches that work without a config change: `?overlay=0` (off for this load) and `?embed=1` (the existing embed mode; the overlay stays off).

## Preview (desk only)

```bash
cd "…/mirror/network-globe/network-globe"
node overlay/preview-server.js 8794                       # mirror schema, rail + home on
PREVIEW_CONFIG=prod node overlay/preview-server.js 8794   # production flags
PREVIEW_SCHEMA=aws-runtime PREVIEW_PAGE=/path/to/aws-index.html PREVIEW_CONFIG=prod node overlay/preview-server.js 8794
PREVIEW_SCHEMA=down node overlay/preview-server.js 8794   # status card failure view
# preview-only query: ?preview_closed=signup,home&preview_rail=open
# v2 preview-only: ?preview_select=arc:0|point:1  ?preview_hover=arc:1  ?preview_spin=off  ?preview_check=1
#   (a probe calls the handlers the overlay registered on the REAL globe.gl and prints a badge;
#    a 3 s /__preview_delay image holds the load event so firefox --screenshot catches it)
```

Never run the real `server.js` on the desk for a preview: it does network capture, geo lookups and `aws` CLI calls.

## v2 (2026-09-29 15:44–16:06 HST): spin toggle, click info, hover, interaction fix

- **Finding the globe.** Both page versions declare `const globe = Globe()(…)` at the top level of a classic `<script>`. That creates a global *lexical* binding: it is not `window.globe`, but the overlay can still reach it by name. If the unpinned `https://unpkg.com/globe.gl` fails to load, the binding stays in TDZ, so `findGlobe()` uses try/catch and the cards still render.
- **Click handlers.** Neither page registers any (`onArcClick`, `onPointClick` and `onGlobeClick` are all unset), so nothing was broken; clicks were simply never wired. The overlay chains onto any handler that already exists instead of replacing it.
- **Actual interaction bug (fixed here).** `poll()` calls `globe.arcsData(d.arcs)` and `globe.pointsData(d.points)` every **1 s** with fresh JSON objects. three-globe's data-bind-mapper keys by **object identity** (`id = d => d`), and `arcsTransitionDuration`/`pointsTransitionDuration` default to 1000 ms. So every arc and point mesh was destroyed and re-created each second and re-played its grow-in animation. Hover state went stale, tooltips dropped, and clicks hit half-grown geometry. Checked in globe.gl 2.46.2 / three-globe 2.45.2 source. `globe.stableData` wraps `arcsData`/`pointsData` on the instance to keep identity per flow key; `index.html` is untouched.
- Tests: `test/overlay.test.js` (jsdom plus a kapsule-style globe stub), 16/16 pass. The real-library check used `preview-server.js ?preview_select=arc:0`: with the real globe.gl from unpkg in headless Firefox, the probe badge read `wired=true · arcClick=function · pointClick=function · stableId=true · autoRotate=false`. Real mouse drag/zoom/click/hover over WebGL is **VERIFY PENDING** in a real browser.

## Deploy to AWS: PROPOSED, needs sign-off, NOT run

Target: `/home/ubuntu/network-globe/network-globe/`, served by `network-globe-web.service` (Express `server.js`, allowlist version since 14:43 HST, sha256 `4ba42236…`, see `../AWS-LIVE-SERVER.md`) behind the `www.rootrecord.cloud` tunnel. That server already has `GET /overlay/:file` for exactly `overlay.js`, `overlay.css` and `overlay-config.json`, so **no server change and no restart** are needed. v2 adds no new files or routes.
Do **not** copy the mirror `server.js` or `index.html` over the runtime copies. They are different implementations (as of 14:29 HST the runtime md5s are `index.html f3d03774…` and `server.js 5b5ef979…`).

```bash
G="/home/rootrecord/RootRecord-Ecosystem/1 - Servers/2 - RootRecord-US-Mainland-Server/mirror/network-globe/network-globe"
H=/home/ubuntu/network-globe/network-globe
# 0. pre-check: the runtime page is unchanged since the design review
ssh rr-aws-ip "md5sum $H/index.html"            # expect f3d0377428a3ac467941c99a075b9d24
# 1. dated backup on the host
ssh rr-aws-ip "B=\$HOME/backups/globe-landing-\$(date +%Y%m%d-%H%M%S) && mkdir -p \$B && cp -a $H/index.html \$B/ && echo \$B"
# 2. overlay files (only the three runtime files)
ssh rr-aws-ip "mkdir -p $H/overlay"
scp "$G/overlay/overlay.js" "$G/overlay/overlay.css" "$G/overlay/overlay-config.json" rr-aws-ip:$H/overlay/
# 3. the one include line (idempotent)
ssh rr-aws-ip "grep -q /overlay/overlay.js $H/index.html || sed -i 's#</body>#  <script src=\"/overlay/overlay.js\" defer></script>\n</body>#' $H/index.html"
# 4. no restart needed: the allowlist server stats/sends overlay files and index.html from disk per request
# 5. verify
curl -sI https://www.rootrecord.cloud/overlay/overlay.js | grep -i content-type      # javascript, not text/html
curl -s  https://www.rootrecord.cloud/ | grep -c /overlay/overlay.js                  # 1
curl -s  https://www.rootrecord.cloud/overlay/overlay-config.json | python3 -m json.tool >/dev/null && echo cfg-ok
curl -s  https://www.rootrecord.cloud/health                                          # JSON status ok
curl -s -o /dev/null -w '%{http_code}\n' https://www.rootrecord.cloud/overlay/preview-server.js     # 404 (allowlist)
# then check by hand in a real browser: Stop spin → reload stays stopped; click an arc and a point → info card (no private IPs, no
# process names); hover highlight; drag/zoom outside the cards; Esc closes the card
# then check by hand on a desktop and a phone: drag and zoom outside the cards, close/restore, reload keeps state
```

Revert, in order of speed:

1. Set `"enabled": false` in `$H/overlay/overlay-config.json`. It takes effect on the next load, with no restart.
2. Remove the line: `sed -i '\#/overlay/overlay.js#d' $H/index.html`.
3. Restore `index.html` from the dated backup and `rm -r $H/overlay`.

Security note: the AWS static-root exposure found at 14:29 was **fixed by the other agent at 14:43 HST** (allowlist server, see `../AWS-LIVE-SERVER.md`). Re-checked 15:46 HST: `/server.js` and `/data/hawaii.ndjson` return 404.


## Deployed state (2026-09-29 16:16 HST)

The heading "Deploy to AWS: PROPOSED" above is superseded: the deploy is **LANDED**.

**Deploy (approved v2, 16:09–16:11 HST): LANDED, all checks PASS.**
- Backups: desk `/home/rootrecord/Database/GITHUB/globe-overlay-deploy.bak-20260929-160933/`; AWS `/home/ubuntu/backups/globe-landing-20260930-020957/` (`index.html`, md5/sha before, `ls` and service state). The deployed v2 overlay files are in `/home/ubuntu/backups/globe-landing-20260930-020957/overlay-v2-as-deployed-021621/`.
- Changes: created `$H/overlay/` with the 3 runtime files (644), and added 1 include line before `</body>`. `index.html` md5 went from `f3d03774…` to `6d9b5af6…`. No restart (`network-globe-web` MainPID 266222, active since 14:43:28 HST).
- Public checks, all PASS: overlay.js/css/config return 200 with the right MIME types and matching sha256; the include appears once on `/` and `/index.html`; `/overlay/preview-server.js`, `/overlay/sample-state.json`, `/overlay/README.md`, `/server.js` and `/data/hawaii.ndjson` all return 404; `/health` and `/api/state` return 200.
- Caching: Cloudflare/browsers cache `overlay.js` for 4 h (`max-age=14400`). The config uses `max-age=0` (DYNAMIC), so `enabled:false` reverts immediately. After the 16:16 update the edge already served the new hash (`cf-cache-status: EXPIRED`), but a returning browser can hold the old JS for up to 4 h unless hard-refreshed.
- Revert: (1) `enabled:false` in `overlay-config.json`; (2) `sed -i '\#/overlay/overlay.js#d' $H/index.html`; (3) restore `index.html` from `/home/ubuntu/backups/globe-landing-20260930-020957/` and `rm -r $H/overlay`. To undo only the AWS-node update, copy back `/home/ubuntu/backups/globe-landing-20260930-020957/overlay-v2-as-deployed-021621/*`.

**Why there were no Ohio lines (read-only check, 16:12 HST).** The live AWS `server.js` (allowlist build, sha256 `4ba42236…`) draws only the desk's own flows from `data/hawaii.ndjson`. Every record is `network-globe-telemetry` from `HawaiiRoot`. `buildState` emits one origin point (Hawaiʻi, 21.31 / -157.86) plus Hawaiʻi→destination arcs. It has no AWS point, no desk↔AWS link and no AWS-side collector. `collector.js` on AWS is the desk-side collector; no ss/tcpdump runs on AWS. `index.html` filters nothing. The overlay and the hiding rules dropped nothing: they only hide fields in the info card, and `stableData` keeps every item. The mirror `server.js` has an AWS origin and a collector, but it was never deployed.

**Fix: overlay only, deployed 16:16 HST, no restart.**
- `overlay.js` adds `withAwsPoint` and `withAwsLink`. They are pure functions in `RR_OVERLAY_UTIL`, applied before the stableData reuse.
- Point: one synthetic AWS point, Ohio 39.96 / -83.0, labelled "AWS us-east-2 · Ohio". It is skipped if the data already has a `type:aws` point, or an origin within 1°.
- Link: one arc from the desk-flow origin to Ohio (`protocol:persistent`, colour `#38bdf8`, altitude 0.28). It is skipped if any persistent arc exists or an arc already starts in Ohio. It is not drawn when there are no desk flows.
- No IP on either one. Info cards: "Desk link · Hawaiʻi desk → AWS Ohio" and "AWS region · 40, -83 · Mainland node · feed + page".
- Flag: `globe.awsNode {enabled, lat, lng, label, link, linkColor}`. Set `enabled:false` in `overlay-config.json` to switch it off (not cached).
- `/api/state` is unchanged: it still has only `origin` and `dest` point types; the AWS items are added client-side.
- Files: `overlay.js` sha256 `e08a20e2…f4c2` (md5 `24cc1906…`), `overlay-config.json` sha256 `08feebc8…6a6f`, `overlay.css` unchanged (`75b3e837…`).

**PROPOSED, not built: AWS's own flows.** A systemd timer or cron job every 30–60 s would run `ss -tunH state established` (or read `/proc/net/tcp`) and write at most 200 aggregated remote endpoints to `data/aws-conns.json`. `server.js` would merge them as Ohio-origin arcs through its existing geo cache.
- RAM: no resident daemon. Each run is a sh/awk process of about 2–5 MB for under 1 s (about 10–15 MB if written in Python); `server.js` grows by less than 1 MB.
- Do not use tcpdump: it needs root, keeps 5–10 MB resident and uses CPU, on a t3.micro with 908 MB.
- Needs a `server.js` change and a web restart, so it needs sign-off. It must also not collide with the other worker's fallback/history files.
