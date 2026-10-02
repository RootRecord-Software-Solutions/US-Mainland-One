
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const net = require('net');
const { execFile } = require('child_process');

const app = express();
const PORT = process.env.PORT || 8080;
const HAWAII_SNAP = process.env.HAWAII_SNAP || '/home/ubuntu/rebroadcast/hawaii-current.ndjson';
const AWS_SNAP = process.env.AWS_SNAP || '/home/ubuntu/rebroadcast/aws-current.ndjson';
const WINDOW_MS = 90000;
const MAX_ARCS = 150;
const GEO_CACHE_FILE = path.join(__dirname, 'data', 'geo-cache.json');

app.use(cors());
app.use(express.json());
// SECURITY (2026-09-29 HST): no root static serve. express.static(__dirname) exposed
// server.js, package*.json, README, data/hawaii.ndjson, the sqlite history, scripts, etc.
// Only an explicit allowlist is served; everything else is 404.
app.disable('x-powered-by');
const INDEX_FILE = path.join(__dirname, 'index.html');
const OVERLAY_DIR = path.join(__dirname, 'overlay');
const OVERLAY_ALLOW = new Set(['overlay.js', 'overlay.css', 'overlay-config.json']);
function notFound(res) { res.status(404).type('text/plain').send('not found\n'); }
function sendIndex(req, res) {
  res.set('Cache-Control', 'no-cache');
  res.sendFile(INDEX_FILE);
}
app.get('/', sendIndex);
app.get('/index.html', sendIndex);
app.get('/overlay/:file', function(req, res) {
  const f = req.params.file;
  if (!OVERLAY_ALLOW.has(f)) return notFound(res);
  const full = path.join(OVERLAY_DIR, f);
  fs.stat(full, function(err, st) {
    if (err || !st.isFile()) return notFound(res);
    res.sendFile(full);
  });
});

const HAWAII_ORIGIN = { lat: 21.3069, lng: -157.8583, label: 'Hawaii' };
const AWS_ORIGIN_FALLBACK = { lat: 40.4173, lng: -82.9071, label: 'AWS Ohio' };
let hawaiiOrigin = Object.assign({}, HAWAII_ORIGIN);
let awsOrigin = Object.assign({}, AWS_ORIGIN_FALLBACK);
const hawaiiFlows = new Map();
const localFlows = new Map();
const geoCache = new Map();
let geoQueue = [];
let geoBusy = false;
let localOk = false;

try {
  if (fs.existsSync(GEO_CACHE_FILE)) {
    const raw = JSON.parse(fs.readFileSync(GEO_CACHE_FILE, 'utf8'));
    for (const [ip, v] of Object.entries(raw)) geoCache.set(ip, v);
    console.log('Loaded geo cache:', geoCache.size);
  }
} catch (e) {}

function saveGeoCache() {
  try { fs.writeFileSync(GEO_CACHE_FILE, JSON.stringify(Object.fromEntries(geoCache))); } catch (e) {}
}

async function lookupGeo(ip) {
  if (!ip || geoCache.has(ip)) return geoCache.get(ip);
  try {
    const r = await fetch('http://ip-api.com/json/' + encodeURIComponent(ip) + '?fields=status,lat,lon,city,country,org', { signal: AbortSignal.timeout(4000) });
    const d = await r.json();
    if (d.status === 'success' && Number.isFinite(d.lat) && Number.isFinite(d.lon)) {
      const entry = { lat: d.lat, lng: d.lon, city: d.city || '', country: d.country || '', org: d.org || '' };
      geoCache.set(ip, entry);
      return entry;
    }
  } catch (e) {}
  geoCache.set(ip, { lat: null, lng: null, city: '', country: '', org: '' });
  return geoCache.get(ip);
}

function enqueueGeo(ip) {
  if (!ip || geoCache.has(ip) || geoQueue.includes(ip)) return;
  geoQueue.push(ip);
}

async function processGeoQueue() {
  if (geoBusy || geoQueue.length === 0) return;
  geoBusy = true;
  while (geoQueue.length) {
    await lookupGeo(geoQueue.shift());
    await new Promise(r => setTimeout(r, 1100));
  }
  saveGeoCache();
  geoBusy = false;
}

function isPrivateIp(ip) {
  if (!ip) return true;
  if (ip.startsWith('::ffff:')) return isPrivateIp(ip.slice(7));
  const v = net.isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || a >= 224;
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    return x === '::' || x === '::1' || x.startsWith('fc') || x.startsWith('fd') ||
      x.startsWith('fe8') || x.startsWith('fe9') || x.startsWith('fea') || x.startsWith('feb') || x.startsWith('ff');
  }
  return true;
}

function parseEndpoint(value) {
  if (!value || value === '*' || value === '*:*') return null;
  value = value.trim();
  if (value.startsWith('[')) {
    const end = value.lastIndexOf(']');
    if (end > 0) {
      const ip = value.slice(1, end).split('%')[0];
      const port = Number(value.slice(end + 1).replace(/^:/, '')) || 0;
      return { ip, port };
    }
  }
  const i = value.lastIndexOf(':');
  if (i > 0) {
    const ip = value.slice(0, i);
    const port = Number(value.slice(i + 1));
    if (net.isIP(ip) && Number.isFinite(port)) return { ip, port };
  }
  return null;
}

function pushArc(arcs, start, ip, item, color) {
  const geo = geoCache.get(ip);
  if (!geo || geo.lat == null || geo.lng == null) return;
  arcs.push({
    startLat: start.lat,
    startLng: start.lng,
    endLat: geo.lat,
    endLng: geo.lng,
    process: item.process || 'network',
    protocol: item.protocol || '',
    endpoint: ip,
    port: item.port || '',
    city: geo.city,
    country: geo.country,
    org: geo.org,
    sourceLabel: start.label,
    color: color,
    altitude: 0.18,
    stroke: 1.2
  });
}

function buildState() {
  const arcs = [];
  const points = [
    { lat: hawaiiOrigin.lat, lng: hawaiiOrigin.lng, label: hawaiiOrigin.label, type: 'origin' },
    { lat: awsOrigin.lat, lng: awsOrigin.lng, label: awsOrigin.label, type: 'aws' }
  ];
  const endpoints = new Set();
  let packetRate = 0;
  let bytesPerSec = 0;
  const windowSec = WINDOW_MS / 1000;

  for (const item of hawaiiFlows.values()) {
    if (!item.ip) continue;
    endpoints.add(item.ip);
    packetRate += (item.packets || 0) / windowSec;
    bytesPerSec += (item.bytes || 0) / windowSec;
    pushArc(arcs, hawaiiOrigin, item.ip, item, '#22c55e');
  }
  for (const item of localFlows.values()) {
    if (!item.ip) continue;
    endpoints.add(item.ip);
    pushArc(arcs, awsOrigin, item.ip, item, '#38bdf8');
  }
  if (hawaiiFlows.size && localOk) {
    arcs.unshift({
      startLat: hawaiiOrigin.lat,
      startLng: hawaiiOrigin.lng,
      endLat: awsOrigin.lat,
      endLng: awsOrigin.lng,
      process: 'Hawaii ↔ Mainland',
      protocol: 'persistent',
      endpoint: 'AWS Mainland node',
      port: '',
      country: 'United States',
      org: awsOrigin.label,
      sourceLabel: hawaiiOrigin.label,
      color: '#38bdf8',
      altitude: 0.28,
      stroke: 1.5
    });
  }

  const limited = arcs.slice(0, MAX_ARCS);
  const seen = new Set();
  for (const a of limited) {
    if (!a.endpoint || a.protocol === 'persistent' || seen.has(a.endpoint)) continue;
    seen.add(a.endpoint);
    points.push({
      lat: a.endLat,
      lng: a.endLng,
      label: (a.city || a.endpoint) + (a.country ? ', ' + a.country : ''),
      type: 'dest'
    });
  }

  return {
    origin: { label: hawaiiOrigin.label + ' + ' + awsOrigin.label },
    stats: {
      activeFlows: hawaiiFlows.size + localFlows.size,
      localActiveFlows: localFlows.size,
      hawaiiActiveFlows: hawaiiFlows.size,
      endpoints: endpoints.size,
      packetRate: Math.round(packetRate * 10) / 10,
      bytesPerSec: Math.round(bytesPerSec),
      collector: 'ss + hawaii snapshot'
    },
    aws: localOk
      ? { ok: true, region: 'us-east-2', label: awsOrigin.label, localFlows: localFlows.size }
      : { ok: false, reason: 'AWS socket sample failed' },
    arcs: limited,
    points: points
  };
}

function readHawaiiSnapshot() {
  try {
    const st = fs.statSync(HAWAII_SNAP);
    if (Date.now() - st.mtimeMs > 3 * 60 * 1000) {
      hawaiiFlows.clear();
      return;
    }
    const next = new Map();
    for (const line of fs.readFileSync(HAWAII_SNAP, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      let rec;
      try { rec = JSON.parse(line); } catch (e) { continue; }
      if (!rec || rec.type !== 'network-globe-telemetry') continue;
      const src = rec.source || {};
      if (Number.isFinite(src.latitude) && Number.isFinite(src.longitude)) {
        hawaiiOrigin = { lat: src.latitude, lng: src.longitude, label: src.label || 'Hawaii' };
      }
      const dest = rec.destination || {};
      if (!dest.ip || isPrivateIp(dest.ip)) continue;
      const key = (rec.protocol || '') + '|' + dest.ip + ':' + (dest.port || 0) + '|' + (rec.process || '');
      next.set(key, {
        ip: dest.ip,
        port: dest.port || '',
        protocol: rec.protocol || '',
        process: rec.process || 'network',
        packets: Number(rec.packets) || 0,
        bytes: Number(rec.bytes) || 0
      });
      enqueueGeo(dest.ip);
    }
    hawaiiFlows.clear();
    for (const [k, v] of next) hawaiiFlows.set(k, v);
  } catch (e) {
    console.error('hawaii snapshot', e.message);
  }
}

function writeAwsSnapshot() {
  const lines = [];
  for (const item of localFlows.values()) {
    lines.push(JSON.stringify({
      type: 'network-globe-telemetry',
      version: 1,
      timestamp: Date.now(),
      sourceNode: 'AwsOhio',
      sourceRegion: 'us-east-2',
      source: { latitude: awsOrigin.lat, longitude: awsOrigin.lng, label: awsOrigin.label },
      destination: { type: 'public-ip', ip: item.ip, port: item.port },
      protocol: item.protocol,
      process: item.process
    }));
  }
  const body = lines.length ? lines.join('\n') + '\n' : '';
  if (body.length > 1024 * 1024) return;
  const tmp = AWS_SNAP + '.tmp';
  fs.writeFileSync(tmp, body);
  fs.renameSync(tmp, AWS_SNAP);
}

function sampleLocal() {
  execFile('ss', ['-H', '-tun', '-p'], { timeout: 3000, maxBuffer: 4 * 1024 * 1024 }, function(err, stdout) {
    if (err) {
      localOk = false;
      return;
    }
    const next = new Map();
    for (const line of String(stdout).split('\n')) {
      const cols = line.trim().split(/\s+/);
      if (cols.length < 6) continue;
      const peer = parseEndpoint(cols[5]);
      if (!peer || isPrivateIp(peer.ip)) continue;
      const proto = cols[0].toLowerCase().startsWith('tcp') ? 'tcp' : cols[0].toLowerCase().startsWith('udp') ? 'udp' : cols[0];
      const m = line.match(/users:\(\("([^"]+)"/);
      const processName = m ? m[1] : 'network';
      const key = proto + '|' + peer.ip + ':' + peer.port + '|' + processName;
      next.set(key, { ip: peer.ip, port: peer.port, protocol: proto, process: processName, packets: 0, bytes: 0 });
      enqueueGeo(peer.ip);
    }
    localFlows.clear();
    for (const [k, v] of next) localFlows.set(k, v);
    localOk = true;
    try { writeAwsSnapshot(); } catch (e) { console.error('aws snapshot', e.message); }
  });
}

function discoverAwsOrigin() {
  execFile('curl', ['-4fsS', '--max-time', '4', 'https://api.ipify.org'], { timeout: 6000 }, function(err, stdout) {
    const ip = String(stdout || '').trim();
    if (err || !net.isIP(ip)) return;
    lookupGeo(ip).then(function(geo) {
      if (geo && geo.lat != null && geo.lng != null) {
        awsOrigin = { lat: geo.lat, lng: geo.lng, label: 'AWS Ohio' };
      }
    }).catch(function() {});
  });
}

app.get('/health', function(req, res) {
  res.json({ status: 'ok', service: 'network-globe', uptime: process.uptime(), flows: hawaiiFlows.size + localFlows.size, hawaii: hawaiiFlows.size, local: localFlows.size, geo: geoCache.size });
});

app.get('/api/state', function(req, res) {
  res.json(buildState());
});

const OPERATIONS_FILE = path.join(__dirname, 'data', 'operations.json');
app.get('/api/operations', function(req, res) {
  fs.readFile(OPERATIONS_FILE, 'utf8', function(err, text) {
    let data = { ok: false, detail: 'no_data' };
    if (!err) {
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object') {
          data = {
            ok: parsed.ok === true,
            as_of: parsed.as_of || null,
            power: parsed.power || null,
            weather: parsed.weather || null,
            kilauea: parsed.kilauea || null
          };
        }
      } catch (e) { /* keep no_data */ }
    }
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    res.json(data);
  });
});

app.use(function(req, res) {
  notFound(res);
});

const BIND = process.env.GLOBE_WEB_BIND || '127.0.0.1'; // cloudflared connects locally
app.listen(PORT, BIND, function() {
  console.log('Network Globe listening on', PORT);
  discoverAwsOrigin();
  readHawaiiSnapshot();
  sampleLocal();
  setInterval(readHawaiiSnapshot, 2000);
  setInterval(sampleLocal, 2000);
  setInterval(processGeoQueue, 2500);
  setInterval(saveGeoCache, 60000);
});
