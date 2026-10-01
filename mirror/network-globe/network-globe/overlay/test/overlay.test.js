// Unit + integration tests for overlay.js v2 (spin toggle, click info, hover, tooltip hardening).
// Run (scratch dir, NOT on the AWS host):  npm i jsdom@24  &&  SRC=<dir> node --test overlay.test.js
// SRC must hold: overlay.js overlay.css overlay-config.json sample-state.json, mirror-index.html (= ../../index.html)
// and aws-index.html (read-only copy of the live AWS page, e.g. backup globe-overlay-v2.bak-20260929-154351/aws-runtime-readonly/index.public.html).
// Result 2026-09-29 ~16:02 HST: 16/16 pass (v2); ~16:20 HST: 18/18 pass (+ awsNode) (jsdom 24, node 20). The globe.gl stub mimics kapsule getters/setters; real-library wiring is checked by preview-server ?preview_select.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const SRC = process.env.SRC || path.join(__dirname, 'src');
const OVJS = fs.readFileSync(path.join(SRC, 'overlay.js'), 'utf8').replace(/<\/script/gi, '<\\/script'); // harness inlines the file
const CFG = JSON.parse(fs.readFileSync(path.join(SRC, 'overlay-config.json'), 'utf8'));
const SAMPLE = JSON.parse(fs.readFileSync(path.join(SRC, 'sample-state.json'), 'utf8'));

// kapsule-like globe.gl stub: every prop is a chainable setter / no-arg getter; controls() is an object.
const STUB = `window.Globe=function(){return function(el){var st={},ctl={autoRotate:false,autoRotateSpeed:1,enableZoom:false};
var api={controls:function(){return ctl},__st:st};
['globeImageUrl','backgroundColor','showAtmosphere','atmosphereColor','atmosphereAltitude','arcColor','arcAltitude','arcStroke','arcDashLength','arcDashGap','arcDashAnimateTime','arcDashInitialGap','arcLabel','pointLabel','pointColor','pointAltitude','pointRadius','pointsMerge','arcsData','pointsData','onArcClick','onPointClick','onGlobeClick','onArcHover','onPointHover'].forEach(function(p){api[p]=function(v){if(!arguments.length)return st[p];st[p]=v;return api}});
window.__stubGlobe=api;return api}};`;

const ARC_PUBLIC = { startLat: 21.3069, startLng: -157.8583, endLat: 35.68, endLng: 139.69, process: 'firefox', protocol: 'tcp', endpoint: '142.250.72.14', port: 443, city: 'Tokyo', country: 'JP', org: 'Google LLC', color: '#22c55e', altitude: 0.18, stroke: 1.2 };
const ARC_XSS = { ...ARC_PUBLIC, endLat: 51.5, endLng: -0.1, endpoint: '8.8.8.8', city: '<b>x</b>', org: '<img src=x onerror=alert(1)>' };
const ARC_PRIVATE = { ...ARC_PUBLIC, endLat: 40, endLng: -83, endpoint: '192.168.1.20', port: 22 };
const ARC_DESKLINK = { startLat: 39.96, startLng: -83, endLat: 21.3, endLng: -157.8, process: 'Hawaii \u2194 Mainland', protocol: 'persistent', port: null, ip: '203.0.113.7', endpoint: 'Hawaii', country: 'United States', asn: 12345, org: 'Hawaiian Telcom', sourceNode: 'HawaiiRoot', sourceRegion: 'local-hawaii' };
const PT_ORIGIN = { lat: 21.3069, lng: -157.8583, label: 'Hawaii', type: 'origin' };
const PT_TOKYO = { lat: 35.68, lng: 139.69, label: 'Tokyo, JP', type: 'dest' };
const STATE = { origin: { label: 'Hawaii' }, stats: { activeFlows: 3, endpoints: 3, collector: 'hawaii-feed' }, aws: { ok: false }, arcs: [ARC_PUBLIC, ARC_XSS, ARC_PRIVATE], points: [PT_ORIGIN, PT_TOKYO] };

function pageFrom(file, { stub = true, globeFails = false, preHandler = false } = {}) {
  let html = fs.readFileSync(path.join(SRC, file), 'utf8');
  html = html.replace(/<script src="\/overlay\/overlay\.js" defer><\/script>\s*/g, '');
  const lib = globeFails ? '<script>/* globe.gl CDN failed */</script>' : `<script>${STUB}</script>`;
  html = html.replace('<script src="https://unpkg.com/globe.gl"></script>', () => lib);
  let extra = '';
  if (preHandler) extra += `<script>window.__pagePointClicks=0;globe.onPointClick(function(){window.__pagePointClicks++});</script>`;
  extra += `<script>${OVJS}</script>`;
  return html.replace('</body>', () => extra + '</body>');
}
async function boot(file, opts = {}) {
  const errors = [];
  const dom = new JSDOM(pageFrom(file, opts), {
    url: 'https://www.rootrecord.cloud/', runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse(w) {
      w.matchMedia = () => ({ matches: !!opts.reducedMotion, addListener() {}, removeListener() {} });
      if (opts.storage) for (const [k, v] of Object.entries(opts.storage)) w.localStorage.setItem(k, v);
      w.fetch = async (u) => {
        const p = new URL(u, 'https://www.rootrecord.cloud/').pathname;
        const body = p === '/overlay/overlay-config.json' ? opts.cfg || CFG : p === '/health' ? { status: 'ok', uptime: 100, flows: 3 } : p === '/api/state' ? STATE : null;
        if (!body) return { ok: false, status: 404, json: async () => { throw new Error('404'); } };
        return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(body)) };
      };
      w.addEventListener('error', (e) => errors.push(e.message));
    }
  });
  OPEN.push(dom);
  const w = dom.window;
  for (let i = 0; i < 100 && !(w.RR_OVERLAY && (opts.globeFails || w.RR_OVERLAY.wired())); i++) await new Promise((r) => setTimeout(r, 20));
  await new Promise((r) => setTimeout(r, 60)); // let the page's first poll fill arcs/points
  return { dom, w, doc: w.document, g: w.__stubGlobe, errors };
}
const OPEN = [];
test.afterEach(() => { while (OPEN.length) { try { OPEN.pop().window.close(); } catch (e) {} } });
const txt = (doc, sel) => (doc.querySelector(sel) || {}).textContent || '';
const rowsOf = (doc) => { const dl = doc.querySelectorAll('#rr-ov-info dt'); const o = {}; dl.forEach((dt) => { o[dt.textContent] = dt.nextElementSibling.textContent; }); return o; };

// ---------------- pure helpers ----------------
test('util: ipKind classifies public/private/names', async () => {
  const { w } = await boot('aws-index.html');
  const U = w.RR_OVERLAY_UTIL;
  for (const ip of ['10.1.2.3', '192.168.0.9', '172.20.1.1', '127.0.0.1', '169.254.1.1', '100.64.0.1', '::1', 'fe80::1', 'fd00::5', '::ffff:10.0.0.1']) assert.equal(U.ipKind(ip), 'private', ip);
  for (const ip of ['8.8.8.8', '142.250.72.14', '2606:4700::1111', '172.32.0.1']) assert.equal(U.ipKind(ip), 'public', ip);
  assert.equal(U.ipKind('Hawaii'), 'name'); assert.equal(U.ipKind(''), null);
  assert.equal(U.scrub('peer 10.0.0.5 via /home/rootrecord/x/y'), 'peer [private] via [path]');
  assert.equal(U.esc('<a href="x">'), '&lt;a href=&quot;x&quot;&gt;');
});
test('util: describeArc hides process, private IP and desk-link IP', async () => {
  const { w } = await boot('aws-index.html');
  const U = w.RR_OVERLAY_UTIL, opt = CFG.globe;
  const pub = Object.fromEntries(U.describeArc(ARC_PUBLIC, { opt, arcs: STATE.arcs }).rows);
  assert.equal(pub.IP, '142.250.72.14'); assert.equal(pub.Location, 'Tokyo, JP'); assert.equal(pub.Network, 'Google LLC');
  assert.equal(pub.Protocol, 'TCP \u00b7 port 443'); assert.equal(pub['Flows here'], '1'); assert.equal(pub.Process, undefined);
  assert.equal(Object.fromEntries(U.describeArc(ARC_PRIVATE, { opt }).rows).IP, 'private (hidden)');
  const dl = U.describeArc(ARC_DESKLINK, { opt });
  const dr = Object.fromEntries(dl.rows);
  assert.equal(dl.title, 'Desk link'); assert.equal(dr.IP, 'hidden (desk link)'); assert.equal(dr.ASN, 'AS12345');
  assert.ok(!JSON.stringify(dl).includes('203.0.113.7')); assert.ok(!JSON.stringify(dl).includes('HawaiiRoot'));
  const withProc = Object.fromEntries(U.describeArc(ARC_PUBLIC, { opt: { ...opt, showProcess: true } }).rows);
  assert.equal(withProc.Process, 'firefox');
  const noIp = Object.fromEntries(U.describeArc(ARC_PUBLIC, { opt: { ...opt, showIp: false } }).rows);
  assert.equal(noIp.IP, undefined);
});
test('util: mirror schema fields (bytes/packets/asn) render', async () => {
  const { w } = await boot('mirror-index.html');
  const U = w.RR_OVERLAY_UTIL;
  const r = Object.fromEntries(U.describeArc({ ...ARC_PUBLIC, endpoint: 'Google LLC', ip: '142.250.72.14', asn: 'AS15169', bytes: 20480, packets: 12, bytesPerSec: 2048 }, { opt: CFG.globe }).rows);
  assert.equal(r.IP, '142.250.72.14'); assert.equal(r.ASN, 'AS15169'); assert.equal(r.Traffic, '2.0 KB/s \u00b7 20.0 KB total \u00b7 12 pkts');
});
test('util: describePoint - origin has no coordinates; dest aggregates flows', async () => {
  const { w } = await boot('aws-index.html');
  const U = w.RR_OVERLAY_UTIL;
  const o = U.describePoint(PT_ORIGIN, { arcs: STATE.arcs });
  const or = Object.fromEntries(o.rows);
  assert.equal(o.title, 'Origin'); assert.equal(or.Coordinates, undefined); assert.equal(or.Flows, '3'); assert.equal(or.Networks, undefined); // pure helper on raw STATE.arcs (no AWS link)
  const t = Object.fromEntries(U.describePoint(PT_TOKYO, { arcs: STATE.arcs }).rows);
  assert.equal(t.Coordinates, '35.7, 139.7'); assert.equal(t.Flows, '1'); assert.equal(t.Networks, 'Google LLC'); assert.equal(t.Ports, 'TCP 443');
});
test('util: safeArcLabel escapes HTML and omits process', async () => {
  const { w } = await boot('aws-index.html');
  const s = w.RR_OVERLAY_UTIL.safeArcLabel(ARC_XSS, CFG.globe);
  assert.ok(!s.includes('<img')); assert.ok(s.includes('&lt;img')); assert.ok(!s.includes('firefox')); assert.ok(s.includes('8.8.8.8:443'));
  assert.ok(!w.RR_OVERLAY_UTIL.safeArcLabel(ARC_DESKLINK, CFG.globe).includes('203.0.113.7'));
});

// ---------------- integration with the live AWS page (stub globe) ----------------
test('spin: button toggles controls().autoRotate and persists in localStorage', async () => {
  const { w, doc, g, errors } = await boot('aws-index.html');
  assert.deepEqual(errors, []);
  const b = doc.getElementById('rr-ov-spin');
  assert.ok(b); assert.equal(b.textContent, '\u23f8 Stop spin'); assert.equal(g.controls().autoRotate, true);
  b.click();
  assert.equal(g.controls().autoRotate, false); assert.equal(b.textContent, '\u25b6 Resume spin'); assert.equal(b.getAttribute('aria-pressed'), 'true');
  assert.equal(w.localStorage.getItem('rr-globe-overlay:v1:spin'), 'off');
  const again = await boot('aws-index.html', { storage: { 'rr-globe-overlay:v1:spin': 'off' } });
  assert.equal(again.g.controls().autoRotate, false, 'remembered off overrides page autoRotate=true');
  assert.equal(again.doc.getElementById('rr-ov-spin').textContent, '\u25b6 Resume spin');
  again.doc.getElementById('rr-ov-spin').click();
  assert.equal(again.g.controls().autoRotate, true); assert.equal(again.w.localStorage.getItem('rr-globe-overlay:v1:spin'), 'on');
});
test('spin: spinDefault=auto respects prefers-reduced-motion', async () => {
  const cfg = JSON.parse(JSON.stringify(CFG)); cfg.globe.spinDefault = 'auto';
  const { g } = await boot('aws-index.html', { cfg, reducedMotion: true });
  assert.equal(g.controls().autoRotate, false);
});
test('click: arc click opens info card (safe fields), pauses spin, close resumes', async () => {
  const { w, doc, g } = await boot('aws-index.html');
  assert.equal(typeof g.onArcClick(), 'function'); assert.equal(typeof g.onPointClick(), 'function'); assert.equal(typeof g.onGlobeClick(), 'function');
  const info = doc.getElementById('rr-ov-info'); assert.ok(info.hidden);
  g.onArcClick()(g.arcsData()[0], {}, {});
  assert.equal(info.hidden, false); assert.equal(txt(doc, '#rr-ov-info h2'), 'Connection');
  assert.ok(doc.getElementById('rr-ov').classList.contains('has-info'), 'has-info class set (phone hides cards)');
  const r = rowsOf(doc);
  assert.equal(r.IP, '142.250.72.14'); assert.equal(r.Location, 'Tokyo, JP'); assert.match(r['Last seen'], /^now · \d\d:\d\d:\d\d HST$/);
  assert.ok(!info.textContent.includes('firefox'));
  assert.equal(g.controls().autoRotate, false, 'spin paused while info open');
  assert.equal(txt(doc, '#rr-ov-info .ov-updated'), 'Live \u00b7 updates every 2 s');
  info.querySelector('.ov-x').click();
  assert.ok(info.hidden); assert.equal(g.controls().autoRotate, true);
  assert.ok(!doc.getElementById('rr-ov').classList.contains('has-info'));
  g.onArcClick()(g.arcsData()[2]);
  assert.equal(rowsOf(doc).IP, 'private (hidden)');
  g.onGlobeClick()({ lat: 0, lng: 0 });
  assert.ok(info.hidden, 'click on empty globe closes the card');
  g.onArcClick()(g.arcsData()[1]);
  assert.equal(info.querySelector('img'), null, 'XSS org rendered as text, no element');
  assert.ok(info.textContent.includes('<img src=x onerror=alert(1)>'), 'shown literally');
  doc.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.ok(info.hidden, 'Escape closes');
});
test('click: point click; card survives data refresh (fresh objects each poll)', async () => {
  const { doc, g } = await boot('aws-index.html');
  g.onPointClick()(g.pointsData()[0]);
  let r = rowsOf(doc);
  assert.equal(txt(doc, '#rr-ov-info h2'), 'Origin'); assert.equal(r.Coordinates, undefined); assert.equal(r.Flows, '4', '3 desk flows + desk↔AWS link');
  g.onPointClick()(g.pointsData()[1]);
  assert.equal(txt(doc, '#rr-ov-info h2'), 'Endpoint'); assert.equal(rowsOf(doc).Coordinates, '35.7, 139.7');
  await new Promise((res) => setTimeout(res, 1150)); // page poll replaced arrays with new objects
  assert.notEqual(g.pointsData()[1], PT_TOKYO);
  assert.equal(txt(doc, '#rr-ov-info .ov-updated'), 'Live \u00b7 updates every 2 s');
});
test('hover: highlight by key, survives new objects; tooltips hardened', async () => {
  const { g } = await boot('aws-index.html');
  const a0 = g.arcsData()[0], a2 = g.arcsData()[2];
  assert.equal(g.arcColor()(a0), '#22c55e');
  g.onArcHover()(a0, null);
  assert.equal(g.arcColor()(a0), '#fde68a'); assert.equal(g.arcColor()(a2), '#22c55e');
  assert.equal(g.arcStroke()(a0), 1.2 * 1.9);
  assert.equal(g.arcColor()({ ...a0 }), '#fde68a', 'copy of the same flow (next poll) stays highlighted');
  g.onArcHover()(null, a0);
  assert.equal(g.arcColor()(a0), '#22c55e');
  g.onPointHover()(g.pointsData()[1]);
  assert.equal(g.pointColor()(g.pointsData()[1]), '#fde68a'); assert.equal(g.pointRadius()(g.pointsData()[1]), 0.3 * 1.7);
  assert.ok(!g.arcLabel()(ARC_XSS).includes('<img')); assert.ok(!g.arcLabel()(ARC_PUBLIC).includes('firefox'));
  assert.equal(g.pointLabel()({ label: '<script>x</script>' }), '&lt;script&gt;x&lt;/script&gt;');
});
test('existing page handlers are chained, not replaced', async () => {
  const { w, g } = await boot('aws-index.html', { preHandler: true });
  g.onPointClick()(g.pointsData()[1]);
  assert.equal(w.__pagePointClicks, 1);
  assert.equal(w.document.getElementById('rr-ov-info').hidden, false);
});
test('flags: clickInfo/hover/spinToggle off -> nothing wired', async () => {
  const cfg = JSON.parse(JSON.stringify(CFG)); Object.assign(cfg.globe, { clickInfo: false, hover: false, spinToggle: false, hardenTooltips: false });
  const { doc, g } = await boot('aws-index.html', { cfg });
  assert.equal(doc.getElementById('rr-ov-spin'), null); assert.equal(doc.getElementById('rr-ov-info'), null);
  assert.equal(g.onArcClick(), undefined); assert.equal(g.onArcHover(), undefined);
  assert.equal(g.controls().autoRotate, true, 'page default untouched');
});
test('globe.gl failed to load (TDZ binding): cards still render, no overlay error', async () => {
  const { w, doc, errors } = await boot('aws-index.html', { globeFails: true });
  assert.ok(doc.getElementById('rr-ov-signup')); assert.ok(doc.getElementById('rr-ov-spin'));
  assert.equal(w.RR_OVERLAY.wired(), false);
  assert.ok(errors.every((m) => /Globe is not defined/.test(m)), 'only the page\'s own error: ' + errors.join('; '));
  doc.getElementById('rr-ov-spin').click(); // must not throw
});
test('mirror page (repo index.html) also wires', async () => {
  const { g, doc, errors } = await boot('mirror-index.html');
  assert.deepEqual(errors, []);
  assert.equal(typeof g.onArcClick(), 'function'); assert.ok(doc.getElementById('rr-ov-spin'));
});
test('stableData: page re-polls keep object identity (no mesh re-create); updates + removals applied', async () => {
  const { w, g } = await boot('aws-index.html');
  const a0 = g.arcsData()[0], p1 = g.pointsData()[1];
  await new Promise((r) => setTimeout(r, 1150)); // one more page poll with fresh JSON objects
  assert.equal(g.arcsData()[0], a0, 'same arc object reused'); assert.equal(g.pointsData()[1], p1, 'same point object reused');
  // direct setter: changed field copied onto the kept object, vanished flow dropped, new flow kept
  const next = [{ ...ARC_PUBLIC, stroke: 2.5 }, { ...ARC_PUBLIC, endLat: -33.9, endLng: 151.2, endpoint: '1.1.1.1' }];
  g.arcsData(next);
  assert.equal(g.arcsData().length, 3, '2 flows + AWS link'); assert.equal(g.arcsData()[0], a0); assert.equal(a0.stroke, 2.5);
  assert.equal(g.arcsData()[1].endpoint, '1.1.1.1');
  assert.equal(g.arcsData()[0].__threeObj, undefined);
});
test('stableData=false leaves the page behaviour (new objects each poll)', async () => {
  const cfg = JSON.parse(JSON.stringify(CFG)); cfg.globe.stableData = false;
  const { g } = await boot('aws-index.html', { cfg });
  const a0 = g.arcsData()[0];
  await new Promise((r) => setTimeout(r, 1150));
  assert.notEqual(g.arcsData()[0], a0);
});

test('awsNode: live AWS data (desk flows only) gets an Ohio AWS point + desk↔AWS link, no IP', async () => {
  const { doc, g, w } = await boot('aws-index.html');
  const pts = g.pointsData(), arcs = g.arcsData();
  const aws = pts.filter((p) => p.type === 'aws');
  assert.equal(aws.length, 1); assert.equal(aws[0].lat, 39.96); assert.equal(aws[0].lng, -83.0);
  const link = arcs.filter((a) => a.protocol === 'persistent');
  assert.equal(link.length, 1); assert.equal(arcs.length, 4);
  assert.equal(link[0].startLat, 21.3069); assert.equal(link[0].endLat, 39.96);
  assert.equal(link[0].ip, undefined); assert.ok(!JSON.stringify(link[0]).match(/\d+\.\d+\.\d+\.\d+/));
  await new Promise((r) => setTimeout(r, 1150)); // next page poll: still exactly one of each (idempotent), same objects
  assert.equal(g.pointsData().filter((p) => p.type === 'aws').length, 1); assert.equal(g.arcsData().filter((a) => a.protocol === 'persistent').length, 1);
  assert.equal(g.arcsData().find((a) => a.protocol === 'persistent'), link[0]);
  g.onArcClick()(link[0]);
  const r = rowsOf(doc);
  assert.equal(txt(doc, '#rr-ov-info h2'), 'Desk link'); assert.equal(txt(doc, '#rr-ov-info .ov-sub'), 'Hawaiʻi desk → AWS Ohio');
  assert.equal(r.IP, undefined); assert.equal(r.Location, 'Hawaiʻi ↔ Mainland'); assert.match(r.Source, /topology/);
  g.onPointClick()(aws[0]);
  assert.equal(txt(doc, '#rr-ov-info h2'), 'AWS region'); assert.equal(rowsOf(doc).Coordinates, '40, -83'); assert.match(rowsOf(doc).Role, /Mainland node/);
  w.RR_OVERLAY.closeInfo();
  assert.equal(g.pointColor()(aws[0]), '#4ade80', 'page colours type=aws points bright green (not selected)');
});
test('awsNode: no desk flows -> AWS point but no link; mirror data with its own AWS origin/link -> nothing added; flag off', async () => {
  const { w } = await boot('aws-index.html');
  const U = w.RR_OVERLAY_UTIL, aw = CFG.globe.awsNode;
  assert.equal(U.withAwsLink([], aw).length, 0);
  assert.equal(U.withAwsPoint([PT_ORIGIN], aw).length, 2);
  assert.equal(U.withAwsPoint([PT_ORIGIN, { lat: 40, lng: -83, type: 'dest', label: 'Columbus' }], aw).length, 3, 'an Ohio dest point does not suppress the AWS node');
  const mirrorArcs = [ARC_DESKLINK, { ...ARC_PUBLIC, startLat: 39.96, startLng: -83 }];
  assert.equal(U.withAwsLink(mirrorArcs, aw), mirrorArcs);
  const mirrorPts = [{ lat: 39.96, lng: -83.0, type: 'origin', label: 'Sample origin' }];
  assert.equal(U.withAwsPoint(mirrorPts, aw), mirrorPts);
  const cfg = JSON.parse(JSON.stringify(CFG)); cfg.globe.awsNode.enabled = false;
  const off = await boot('aws-index.html', { cfg });
  assert.equal(off.g.pointsData().filter((p) => p.type === 'aws').length, 0); assert.equal(off.g.arcsData().length, 3);
});
