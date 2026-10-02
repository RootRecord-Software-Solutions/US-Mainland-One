# AWS live `server.js`: static allowlist (2026-09-29 14:43 HST)

`server.aws-live-2026-09-29-allowlist.js` in this folder is a **byte-for-byte copy of the file running on AWS** at `/home/ubuntu/network-globe/network-globe/server.js` (sha256 `4ba42236cfde413e102044daf392288452475df57d52709dda88bf6720f0e9fc`), served by `network-globe-web.service` → tunnel [redacted tunnel ID] → `https://www.rootrecord.cloud`.

- **It is not the same file as this folder's `server.js`**, which is the repo/desk version (being edited separately for the globe landing overlay). Never copy either file over the other, and never copy the repo's `index.html` over the AWS one. Merge them deliberately.
- AWS backup of the pre-change file: `/home/ubuntu/rootrecord/bin.bak-globe-static-allowlist-20260929-144149/` (`server.js`, `index.html`, unit, sha256 before/after, access-evidence snapshot).

## Why

The AWS file had `app.use(express.static(__dirname))`, so `/server.js`, `/package*.json`, `/README.md`, `/collector.js`, `/telegram-relay.js`, `/scripts/*.sh`, `/data/hawaii.ndjson`, `/data/hawaii-connections.sqlite3`, `/data/geo-cache.json`, `/node_modules/**` and more were all public. Its catch-all also returned `index.html` with a 200 for every unknown path.

## What changed (only this; the rest of the file is untouched)

1. The root static serve was removed. Explicit routes remain: `GET /` and `GET /index.html` → `index.html`; `GET /overlay/:file`, only for `overlay.js`, `overlay.css`, `overlay-config.json` from `./overlay/` (404 if the file is absent; ready for a future overlay deploy); `/health`; `/api/state`. The page has no websocket/SSE route; it polls `/api/state` every 1 s.
2. The catch-all is now `404 text/plain`.
3. `app.disable('x-powered-by')`.
4. It listens on `GLOBE_WEB_BIND || 127.0.0.1` (cloudflared connects locally). Port 8090 was already closed at the security group.

## Diff (AWS before → after)

```diff
--- /tmp/aws-server.before.js	2026-09-29 14:45:05.957936345 -1000
+++ "/home/rootrecord/RootRecord-Ecosystem/1 - Servers/2 - RootRecord-US-Mainland-One/mirror/network-globe/network-globe/server.aws-live-2026-09-29-allowlist.js"	2026-09-29 14:45:03.015929471 -1000
@@ -14,7 +14,29 @@
 
 app.use(cors());
 app.use(express.json());
-app.use(express.static(__dirname));
+// SECURITY (2026-09-29 HST): no root static serve. express.static(__dirname) exposed
+// server.js, package*.json, README, data/hawaii.ndjson, the sqlite history, scripts, etc.
+// Only an explicit allowlist is served; everything else is 404.
+app.disable('x-powered-by');
+const INDEX_FILE = path.join(__dirname, 'index.html');
+const OVERLAY_DIR = path.join(__dirname, 'overlay');
+const OVERLAY_ALLOW = new Set(['overlay.js', 'overlay.css', 'overlay-config.json']);
+function notFound(res) { res.status(404).type('text/plain').send('not found\n'); }
+function sendIndex(req, res) {
+  res.set('Cache-Control', 'no-cache');
+  res.sendFile(INDEX_FILE);
+}
+app.get('/', sendIndex);
+app.get('/index.html', sendIndex);
+app.get('/overlay/:file', function(req, res) {
+  const f = req.params.file;
+  if (!OVERLAY_ALLOW.has(f)) return notFound(res);
+  const full = path.join(OVERLAY_DIR, f);
+  fs.stat(full, function(err, st) {
+    if (err || !st.isFile()) return notFound(res);
+    res.sendFile(full);
+  });
+});
 
 let origin = { lat: 21.3069, lng: -157.8583, label: 'Hawaii' };
 const flows = new Map();
@@ -201,10 +223,11 @@
 });
 
 app.use(function(req, res) {
-  res.sendFile(path.join(__dirname, 'index.html'));
+  notFound(res);
 });
 
-app.listen(PORT, function() {
+const BIND = process.env.GLOBE_WEB_BIND || '127.0.0.1'; // cloudflared connects locally
+app.listen(PORT, BIND, function() {
   console.log('Network Globe listening on', PORT);
   bootstrapFeed();
   setInterval(readNewRecords, 2000);
```

## connection-history.py: batched commits (2026-09-29 15:49 HST)

The AWS live copy is now `connection-history.py` in this folder (sha256 `ed1423a3…0d56`). The previous live copy is kept as `connection-history.aws-live-2026-09-26.py`.
- Commits every 5 s instead of once per record: 43.9 MB/min of writes became 1.6 MB/min.
- The cursor `data/hawaii-history-cursor.json` (inode + offset) is persisted, so an in-place trim or a restart no longer re-counts the feed.
- `GLOBE_HISTORY_SEND=0` exists for test copies only.

Record: Library `07-testing/2026-09-29-aws-globe-history-batched-commits.md`.


## Overlay include (2026-09-29 16:10 HST, globe-overlay work)

`index.html` now has one extra line before `</body>`: `<script src="/overlay/overlay.js" defer></script>`. Its md5 went from `f3d03774…` to `6d9b5af6…`. The files are in `$H/overlay/` (overlay.js, overlay.css, overlay-config.json), already on this server's allowlist. `server.js` is unchanged and there was no restart. Backup: `/home/ubuntu/backups/globe-landing-20260930-020957/`. Revert: `sed -i '\#/overlay/overlay.js#d' $H/index.html`.
