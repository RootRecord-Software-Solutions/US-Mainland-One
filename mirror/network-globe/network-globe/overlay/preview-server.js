#!/usr/bin/env node
/* Local preview for the globe landing overlay. Binds 127.0.0.1 ONLY.
   Serves ../index.html, the overlay files, and SYNTHETIC /healthz + /api/state
   from sample-state.json. Does no network observation, geo lookups or AWS calls
   (unlike ../server.js). Not for deployment.
     node overlay/preview-server.js [port]        (default 8791)
     PREVIEW_CONFIG=prod  -> serve overlay-config.json as-is (production flags)
     PREVIEW_CONFIG=full  -> (default) rail + home card on, URL overrides allowed
     PREVIEW_SCHEMA=aws-runtime -> mimic the Express server.js running on AWS
                   (29 Sep 2026, allowlist version): /health {status,uptime,flows,geo},
                   no /healthz (404), stats without updated/hawaiiActiveFlows
     PREVIEW_PAGE=/path/index.html -> serve a different page (e.g. a read-only
                   copy of the AWS runtime index.html); the overlay <script>
                   line is injected if the page lacks it
     PREVIEW_SCHEMA=down -> health + state answer 503 (status card failure view)
   Preview-only query (v2): ?preview_select=arc:0|point:1  ?preview_hover=arc:1  ?preview_spin=off  ?preview_check=1
   Preview-only query: ?preview_closed=signup,status pre-marks cards as closed
   in localStorage (used for screenshots of the restore dock). */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const DIR = __dirname;
const PAGE = path.join(DIR, '..', 'index.html');
const PORT = Number(process.argv[2] || 8791);
const MODE = process.env.PREVIEW_CONFIG || 'full';
const STARTED = Date.now();
const SCHEMA = process.env.PREVIEW_SCHEMA || 'mirror';
const PAGE_FILE = process.env.PREVIEW_PAGE || PAGE;
const INCLUDE = '<script src="/overlay/overlay.js" defer></script>';
const FILES = { '/overlay/overlay.js': ['overlay.js', 'application/javascript'], '/overlay/overlay.css': ['overlay.css', 'text/css'] };

// AWS runtime /api/state shape: origin Hawaii, endpoint = remote IP, no ip/asn/bytes fields
const HNL = [21.3069, -157.8583];
function rtArcs(arcs) {
  return arcs.filter(a => a.protocol !== 'persistent').map(a => ({ startLat: HNL[0], startLng: HNL[1], endLat: a.endLat, endLng: a.endLng,
    process: a.process, protocol: a.protocol, endpoint: a.ip, port: a.port, city: a.city, country: a.country, org: a.org, color: '#22c55e', altitude: 0.18, stroke: 1.2 }));
}
function rtPoints(arcs) {
  return [{ lat: HNL[0], lng: HNL[1], label: 'Hawaii', type: 'origin' }].concat(rtArcs(arcs).map(a => ({ lat: a.endLat, lng: a.endLng, label: a.city + ', ' + a.country, type: 'dest' })));
}
function send(res, code, type, body) {
  res.writeHead(code, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
function config() {
  const c = JSON.parse(fs.readFileSync(path.join(DIR, 'overlay-config.json'), 'utf8'));
  if (MODE === 'full') { c.allowUrlOverrides = true; c.rail.enabled = true; c.cards.home.enabled = true; }
  return c;
}
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  if (u.pathname === '/' || u.pathname === '/index.html') {
    let html = fs.readFileSync(PAGE_FILE, 'utf8');
    if (!html.includes('/overlay/overlay.js')) html = html.replace('</body>', '  ' + INCLUDE + '\n</body>');
    const closed = (u.searchParams.get('preview_closed') || '').split(',').filter(x => /^(signup|home|status)$/.test(x));
    const pre = '<script>try{' + ['signup', 'home', 'status'].map(id =>
      closed.includes(id) ? `localStorage.setItem('rr-globe-overlay:v1:closed:${id}','1');` : `localStorage.removeItem('rr-globe-overlay:v1:closed:${id}');`).join('') +
      `localStorage.setItem('rr-globe-overlay:v1:rail','${u.searchParams.get('preview_rail') === 'open' ? 'open' : 'closed'}');` +
      `localStorage.setItem('rr-globe-overlay:v1:spin','${u.searchParams.get('preview_spin') === 'off' ? 'off' : 'on'}');}catch(e){}</script>`;
    html = html.replace('<head>', () => '<head>' + pre);
    // Preview-only real-library check: ?preview_select=arc:0|point:1 [&preview_hover=arc:1]
    // waits for the overlay to wire the REAL globe.gl instance, then calls the handlers the
    // overlay registered (globe.onArcClick()/onPointClick()/onArcHover()) and prints a badge.
    const selm = /^(arc|point):(\d{1,3})$/.exec(u.searchParams.get('preview_select') || '');
    const hovm = /^(arc|point):(\d{1,3})$/.exec(u.searchParams.get('preview_hover') || '');
    if (selm || hovm || u.searchParams.get('preview_check') === '1') {
      const probe = `<script>(function(){var n=0,t=setInterval(function(){n++;var ok=window.RR_OVERLAY&&RR_OVERLAY.wired();var g=null;try{g=globe}catch(e){}
if(!(ok&&g&&(g.arcsData()||[]).length)&&n<120)return;clearInterval(t);var r=[];
try{r.push('wired='+!!ok);r.push('arcClick='+typeof g.onArcClick());r.push('pointClick='+typeof g.onPointClick());
var a0=g.arcsData()[0];${hovm ? `g.on${hovm[1] === 'arc' ? 'Arc' : 'Point'}Hover()(g.${hovm[1]}sData()[${hovm[2]}],null);` : ''}
${selm ? `g.on${selm[1] === 'arc' ? 'Arc' : 'Point'}Click()(g.${selm[1]}sData()[${selm[2]}],{},{});` : ''}
setTimeout(function(){r.push('stableId='+(g.arcsData()[0]===a0));r.push('autoRotate='+g.controls().autoRotate);
var b=document.createElement('div');b.id='rr-preview-probe';b.textContent='PREVIEW PROBE (real globe.gl): '+r.join(' · ');
b.style.cssText='position:fixed;left:50%;top:6px;transform:translateX(-50%);z-index:99;font:11px monospace;color:#fde68a;background:rgba(0,0,0,.7);padding:3px 8px;border-radius:6px';
document.body.appendChild(b)},1300)}catch(e){r.push('ERR '+e.message)}},50)})();</script>`;
      // hold the window load event ~3 s so `firefox --screenshot` captures after the probe ran
      html = html.replace('</body>', () => probe + '\n<img alt="" width="1" height="1" style="position:fixed;opacity:0" src="/__preview_delay?ms=3000">\n</body>');
    }
    return send(res, 200, 'text/html', html);
  }
  if (u.pathname === '/__preview_delay') {
    const ms = Math.min(5000, Number(u.searchParams.get('ms')) || 0);
    return setTimeout(() => { res.writeHead(200, { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store' }); res.end(Buffer.from('R0lGODlhAQABAAAAACw=', 'base64')); }, ms);
  }
  if (u.pathname === '/overlay/overlay-config.json') return send(res, 200, 'application/json', JSON.stringify(config()));
  if (FILES[u.pathname]) return send(res, 200, FILES[u.pathname][1], fs.readFileSync(path.join(DIR, FILES[u.pathname][0])));
  if (SCHEMA === 'down' && /^\/(health|healthz|api\/state)$/.test(u.pathname)) return send(res, 503, 'text/plain', 'down (preview)');
  if (SCHEMA === 'aws-runtime') {
    if (u.pathname === '/health') return send(res, 200, 'application/json', JSON.stringify({ status: 'ok', service: 'network-globe', uptime: (Date.now() - STARTED) / 1000 + 967, flows: 67, geo: 57 }));
    if (u.pathname === '/api/state') {
      const s = JSON.parse(fs.readFileSync(path.join(DIR, 'sample-state.json'), 'utf8'));
      return send(res, 200, 'application/json', JSON.stringify({ origin: { label: 'Hawaii' }, stats: { activeFlows: 67, endpoints: 57, packetRate: 0, bytesPerSec: 0, collector: 'hawaii-feed' }, aws: { ok: false, reason: 'No AWS telemetry connected' }, arcs: rtArcs(s.arcs), points: rtPoints(s.arcs) }));
    }
    return send(res, 404, 'text/plain', 'not found\n'); // AWS allowlist server (14:43 HST) 404s unknown paths
  }
  if (u.pathname === '/healthz') return send(res, 200, 'application/json', JSON.stringify({ ok: true, uptimeSec: Math.round((Date.now() - STARTED) / 1000) + 93784, collector: 'ss', hawaiiCollector: 'ssh ndjson stream', activeFlows: 14, aws: true }));
  if (u.pathname === '/api/state') {
    const s = JSON.parse(fs.readFileSync(path.join(DIR, 'sample-state.json'), 'utf8'));
    delete s._comment; s.stats.updated = Date.now();
    return send(res, 200, 'application/json', JSON.stringify(s));
  }
  send(res, 404, 'text/plain', 'Not found');
}).listen(PORT, '127.0.0.1', () => console.log(`overlay preview on http://127.0.0.1:${PORT}/ (config=${MODE})`));
