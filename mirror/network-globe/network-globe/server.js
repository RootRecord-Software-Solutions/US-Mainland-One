const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const dns = require('dns');
const { execFile, spawn } = require('child_process');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 8090);
const POLL_MS = Number(process.env.POLL_MS || 2000);
const AWS_POLL_MS = Number(process.env.AWS_POLL_MS || 30000);
const HISTORY_LIMIT = Number(process.env.HISTORY_LIMIT || 3000);
const FLOW_TTL_MS = Number(process.env.FLOW_TTL_MS || 12000);
const PACKET_WINDOW_MS = Number(process.env.PACKET_WINDOW_MS || 10000);
const GEO_TTL_MS = Number(process.env.GEO_TTL_MS || 30 * 24 * 60 * 60 * 1000);
const GEO_DELAY_MS = Number(process.env.GEO_DELAY_MS || 1200);
const HAWAII_POLL_MS = Number(process.env.HAWAII_POLL_MS || 2000);
const HAWAII_FLOW_TTL_MS = Number(process.env.HAWAII_FLOW_TTL_MS || 5 * 60 * 1000);

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const GEO_FILE = path.join(DATA_DIR, 'geo-cache.json');
const AWS_STATE_FILE = path.join(DATA_DIR, 'aws-state.json');
const HAWAII_FILE = path.join(DATA_DIR, 'hawaii.ndjson');
const HAWAII_OFFSET_FILE = path.join(DATA_DIR, 'hawaii-offset.json');
const PAGE_FILE = path.join(ROOT, 'index.html');

fs.mkdirSync(DATA_DIR, { recursive: true });

function loadJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function atomicWrite(file, value) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

const geoCache = loadJson(GEO_FILE, {});
const history = loadJson(HISTORY_FILE, []);
let awsState = loadJson(AWS_STATE_FILE, { ok: false, checkedAt: 0, reason: 'not checked yet' });
let localAddresses = new Set(['127.0.0.1', '::1']);
let currentFlows = new Map();
let packetWindow = [];
let origin = null;
let geoQueue = [];
let geoBusy = false;
let lastPayload = null;
let tcpdumpProc = null;
let collectorStarted = false;
let awsBusy = false;
let lastAwsCheck = 0;
let hawaiiFlows = new Map();
let hawaiiOffset = loadJson(HAWAII_OFFSET_FILE, { offset: 0, partial: '' });
let hawaiiBusy = false;

const regionCoords = {
  'us-east-1': [39.0438, -77.4874],
  'us-east-2': [40.4173, -82.9071],
  'us-west-1': [37.7749, -122.4194],
  'us-west-2': [45.8399, -119.7006],
  'ca-central-1': [46.8139, -71.2080],
  'ca-west-1': [51.0447, -114.0719],
  'eu-west-1': [53.3498, -6.2603],
  'eu-west-2': [51.5074, -0.1278],
  'eu-west-3': [48.8566, 2.3522],
  'eu-central-1': [50.1109, 8.6821],
  'eu-central-2': [47.3769, 8.5417],
  'eu-north-1': [59.3293, 18.0686],
  'eu-south-1': [45.4642, 9.19],
  'eu-south-2': [40.4168, -3.7038],
  'af-south-1': [-33.9249, 18.4241],
  'ap-south-1': [19.0760, 72.8777],
  'ap-south-2': [24.8607, 67.0011],
  'ap-southeast-1': [1.3521, 103.8198],
  'ap-southeast-2': [-33.8688, 151.2093],
  'ap-southeast-3': [-6.2088, 106.8456],
  'ap-southeast-4': [3.1390, 101.6869],
  'ap-southeast-5': [18.7883, 98.9853],
  'ap-southeast-6': [13.7563, 100.5018],
  'ap-northeast-1': [35.6762, 139.6503],
  'ap-northeast-2': [37.5665, 126.9780],
  'ap-northeast-3': [34.6937, 135.5023],
  'ap-east-1': [22.3193, 114.1694],
  'me-south-1': [26.2235, 50.5876],
  'me-central-1': [25.2048, 55.2708],
  'il-central-1': [32.0853, 34.7818],
  'sa-east-1': [-23.5505, -46.6333],
  'mx-central-1': [19.4326, -99.1332]
};

function safeJson(code, data, res) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    fs.createReadStream(PAGE_FILE).pipe(res);
    return;
  }
  if (url.pathname === '/healthz') {
    return safeJson(200, {
      ok: true,
      uptimeSec: Math.round(process.uptime()),
      collector: collectorStarted ? 'ss + tcpdump' : 'ss',
      hawaiiCollector: 'ssh ndjson stream',
      activeFlows: currentFlows.size,
      aws: awsState.ok,
      origin
    }, res);
  }
  if (url.pathname === '/api/state') return safeJson(200, lastPayload || buildPayload(), res);
  if (url.pathname === '/api/history') return safeJson(200, history, res);
  if (url.pathname === '/api/aws') return safeJson(200, awsState, res);
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
});

function isPrivateIp(ip) {
  if (!ip) return true;
  if (ip.startsWith('::ffff:')) return isPrivateIp(ip.slice(7));
  const version = net.isIP(ip);
  if (version === 4) {
    const [a, b] = ip.split('.').map(Number);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return true;
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || a >= 224;
  }
  if (version === 6) {
    const x = ip.toLowerCase();
    return x === '::' || x === '::1' || x.startsWith('fc') || x.startsWith('fd') ||
      x.startsWith('fe8') || x.startsWith('fe9') || x.startsWith('fea') || x.startsWith('feb') || x.startsWith('ff');
  }
  return true;
}

function parseSsEndpoint(value) {
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

function parseSsLine(line) {
  const cols = line.trim().split(/\s+/);
  if (cols.length < 6) return null;
  const proto = cols[0].toLowerCase();
  const local = parseSsEndpoint(cols[4]);
  const peer = parseSsEndpoint(cols[5]);
  if (!local || !peer || !net.isIP(peer.ip) || isPrivateIp(peer.ip)) return null;
  const m = line.match(/users:\(\("([^"]+)"(?:,pid=(\d+))?/);
  const process = m ? m[1] : 'unknown';
  const pid = m && m[2] ? Number(m[2]) : null;
  if (pid === process.pid) return null;
  const key = `${proto}|${local.ip}:${local.port}|${peer.ip}:${peer.port}`;
  return { key, proto, local, peer, process, pid };
}

function refreshLocalAddresses() {
  return new Promise(resolve => {
    execFile('ip', ['-j', 'addr'], { timeout: 3000, maxBuffer: 2 * 1024 * 1024 }, (err, stdout) => {
      if (!err) {
        try {
          const data = JSON.parse(stdout);
          const next = new Set(['127.0.0.1', '::1']);
          for (const iface of data) for (const a of iface.addr_info || []) if (a.local) next.add(a.local.split('%')[0]);
          localAddresses = next;
        } catch {}
      }
      resolve();
    });
  });
}

function runSs() {
  return new Promise(resolve => {
    const args = ['-H', '-tun', '-p'];
    execFile('ss', args, { timeout: 3000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve([]);
      const rows = stdout.split('\n').map(parseSsLine).filter(Boolean);
      resolve(rows);
    });
  });
}

function publicEndpointForOrigin() {
  return new Promise(resolve => {
    execFile('curl', ['-4fsS', '--max-time', '4', 'https://api.ipify.org'], { timeout: 6000 }, (err, stdout) => {
      const ip = stdout.trim();
      resolve(!err && net.isIP(ip) ? ip : null);
    });
  });
}

async function httpJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const r = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'network-globe/3.0' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(timer); }
}

async function lookupIp(ip) {
  const cached = geoCache[ip];
  if (cached && cached.ts && Date.now() - cached.ts < GEO_TTL_MS && cached.lat != null) return cached;
  const providers = [
    `https://ipapi.co/${encodeURIComponent(ip)}/json/`,
    `https://ipwho.is/${encodeURIComponent(ip)}`
  ];
  for (const url of providers) {
    try {
      const d = await httpJson(url);
      const lat = Number(d.latitude ?? d.latitude);
      const lng = Number(d.longitude ?? d.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const record = {
        ip, lat, lng,
        city: d.city || null,
        region: d.region || d.region_name || null,
        country: d.country_name || d.country || null,
        countryCode: d.country_code || null,
        asn: d.asn || d.connection?.asn || null,
        org: d.org || d.connection?.org || d.connection?.isp || null,
        ts: Date.now()
      };
      geoCache[ip] = record;
      atomicWrite(GEO_FILE, geoCache);
      return record;
    } catch {}
  }
  return cached || null;
}

function enqueueGeo(ip) {
  if (!ip || isPrivateIp(ip) || geoCache[ip]?.lat != null || geoQueue.includes(ip)) return;
  geoQueue.push(ip);
  processGeoQueue();
}

async function processGeoQueue() {
  if (geoBusy || !geoQueue.length) return;
  geoBusy = true;
  const ip = geoQueue.shift();
  try { await lookupIp(ip); }
  finally {
    geoBusy = false;
    if (geoQueue.length) setTimeout(processGeoQueue, GEO_DELAY_MS);
  }
}

async function discoverOrigin() {
  const forcedLat = Number(process.env.ORIGIN_LAT);
  const forcedLng = Number(process.env.ORIGIN_LNG);
  if (Number.isFinite(forcedLat) && Number.isFinite(forcedLng)) {
    origin = { lat: forcedLat, lng: forcedLng, label: process.env.ORIGIN_LABEL || 'Local network' };
    return;
  }
  const ip = await publicEndpointForOrigin();
  if (!ip) return;
  const g = await lookupIp(ip);
  if (g?.lat != null) origin = {
    lat: g.lat,
    lng: g.lng,
    label: g.city ? `${g.city}, ${g.country || ''}`.replace(/, $/, '') : 'Public network',
    ip: g.ip,
    asn: g.asn,
    org: g.org
  };
}

function addPacketEvent(src, dst, proto, bytes) {
  const now = Date.now();
  const outbound = localAddresses.has(src.ip);
  const local = outbound ? src : dst;
  const remote = outbound ? dst : src;
  if (!localAddresses.has(local.ip) || isPrivateIp(remote.ip)) return;
  packetWindow.push({ key: `${proto}|${local.ip}:${local.port}|${remote.ip}:${remote.port}`, packets: 1, bytes, ts: now });
  if (packetWindow.length > 50000) packetWindow.splice(0, packetWindow.length - 50000);
}

function parseTcpdumpEndpoint(value) {
  value = value.replace(/^\[|\]$/g, '').replace(/^[^\s]+\s+/, '').trim();
  const i = value.lastIndexOf('.');
  if (i <= 0) return null;
  const ip = value.slice(0, i).replace(/^IP6?\s+/, '').trim();
  const port = Number(value.slice(i + 1));
  if (!net.isIP(ip) || !Number.isFinite(port)) return null;
  return { ip, port };
}

function handleTcpdumpLine(line) {
  const cleaned = line.trim().replace(/^\S+\s+IP6?\s+/, '').replace(/^IP6?\s+/, '');
  const parts = cleaned.split(' > ');
  if (parts.length < 2) return;
  const left = parts[0].trim();
  const right = parts[1].split(':')[0].trim();
  const src = parseTcpdumpEndpoint(left);
  const dst = parseTcpdumpEndpoint(right);
  if (!src || !dst) return;
  const proto = cleaned.startsWith('IP6 ') || line.includes(' IP6 ') ? 'tcp/udp6' : 'tcp/udp';
  const len = Number((line.match(/\blength\s+(\d+)/) || [])[1] || 0);
  addPacketEvent(src, dst, proto, len);
}

function startTcpdump() {
  if (!(process.getuid && process.getuid() === 0)) return;
  try {
    tcpdumpProc = spawn('tcpdump', ['-l', '-n', '-q', '-i', 'any', 'ip or ip6'], { stdio: ['ignore', 'pipe', 'pipe'] });
    tcpdumpProc.stdout.setEncoding('utf8');
    let buffer = '';
    tcpdumpProc.stdout.on('data', chunk => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) handleTcpdumpLine(line);
    });
    tcpdumpProc.on('close', () => { collectorStarted = false; });
    tcpdumpProc.on('error', () => { collectorStarted = false; });
    collectorStarted = true;
  } catch {}
}

function packetStatsForFlow(flowKey) {
  const cutoff = Date.now() - PACKET_WINDOW_MS;
  let packets = 0;
  let bytes = 0;
  const keep = [];
  for (const e of packetWindow) {
    if (e.ts >= cutoff) {
      keep.push(e);
      if (e.key === flowKey) { packets += e.packets; bytes += e.bytes; }
    }
  }
  packetWindow = keep;
  return { packets, bytes };
}

function updateFlows(rows) {
  const now = Date.now();
  const next = new Map();
  for (const row of rows) {
    const prev = currentFlows.get(row.key);
    const flow = {
      ...row,
      firstSeen: prev?.firstSeen || now,
      lastSeen: now
    };
    next.set(row.key, flow);
    enqueueGeo(row.peer.ip);
  }
  for (const [key, flow] of currentFlows) {
    if (!next.has(key) && now - flow.lastSeen < FLOW_TTL_MS) next.set(key, flow);
  }
  currentFlows = next;
}


function hawaiiFlowKey(record) {
  const d = record.destination || {};
  return `${record.sourceNode || 'HawaiiRoot'}|${record.protocol || 'unknown'}|${d.ip || ''}:${d.port || 0}|${record.process || 'unknown'}`;
}

function ingestHawaiiRecord(record) {
  if (!record || record.type !== 'network-globe-telemetry' || record.version !== 1) return;
  const d = record.destination || {};
  const s = record.source || {};
  if (!net.isIP(d.ip) || isPrivateIp(d.ip)) return;
  const lat = Number(s.latitude), lng = Number(s.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
  const ts = Number(record.timestamp) || Date.now();
  const key = hawaiiFlowKey(record);
  hawaiiFlows.set(key, {
    key,
    sourceNode: record.sourceNode || 'HawaiiRoot',
    sourceRegion: record.sourceRegion || 'local-hawaii',
    source: {
      lat, lng,
      label: s.label || record.sourceNode || 'Hawaii',
      ip: s.publicIp || null,
      asn: s.asn || null,
      org: s.organization || null
    },
    peer: { ip: d.ip, port: Number(d.port) || 0 },
    proto: record.protocol || 'unknown',
    process: record.process || 'unknown',
    packets: Number(record.packets) || 0,
    bytes: Number(record.bytes) || 0,
    timestamp: ts,
    lastSeen: Date.now()
  });
  enqueueGeo(d.ip);
}

function pollHawaii() {
  if (hawaiiBusy) return;
  hawaiiBusy = true;
  try {
    if (!fs.existsSync(HAWAII_FILE)) return;
    const stat = fs.statSync(HAWAII_FILE);
    if (stat.size < Number(hawaiiOffset.offset || 0)) {
      hawaiiOffset = { offset: 0, partial: '' };
    }
    const fd = fs.openSync(HAWAII_FILE, 'r');
    try {
      const start = Number(hawaiiOffset.offset || 0);
      const len = stat.size - start;
      if (len <= 0) return;
      const buf = Buffer.allocUnsafe(Math.min(len, 4 * 1024 * 1024));
      let position = start;
      let partial = hawaiiOffset.partial || '';
      while (position < stat.size) {
        const want = Math.min(buf.length, stat.size - position);
        const n = fs.readSync(fd, buf, 0, want, position);
        if (!n) break;
        position += n;
        partial += buf.subarray(0, n).toString('utf8');
        const lines = partial.split('\n');
        partial = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try { ingestHawaiiRecord(JSON.parse(line)); } catch {}
        }
      }
      hawaiiOffset = { offset: position, partial };
      atomicWrite(HAWAII_OFFSET_FILE, hawaiiOffset);
    } finally {
      fs.closeSync(fd);
    }
  } catch {} finally {
    hawaiiBusy = false;
  }
}

function pruneHawaiiFlows() {
  const cutoff = Date.now() - HAWAII_FLOW_TTL_MS;
  for (const [key, flow] of hawaiiFlows) if (flow.lastSeen < cutoff) hawaiiFlows.delete(key);
}

function awsExec(args) {
  return new Promise(resolve => {
    execFile('aws', args, { timeout: 12000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return resolve({ ok: false, error: String(stderr || err.message).trim() });
      try { resolve({ ok: true, value: JSON.parse(stdout) }); }
      catch { resolve({ ok: false, error: 'AWS returned non-JSON output' }); }
    });
  });
}

function resourceCount(value, pathParts) {
  let x = value;
  for (const p of pathParts) x = x?.[p];
  return Array.isArray(x) ? x.length : 0;
}

async function refreshAws() {
  if (awsBusy) return;
  awsBusy = true;
  const checkedAt = Date.now();
  try {
    const identity = await awsExec(['sts', 'get-caller-identity', '--output', 'json']);
    const regionResult = await awsExec(['configure', 'get', 'region']);
    const region = regionResult.ok && typeof regionResult.value === 'string' ? regionResult.value : (regionResult.ok ? String(regionResult.value) : (process.env.AWS_REGION || 'us-east-1'));
    if (!identity.ok) {
      awsState = { ok: false, checkedAt, reason: identity.error, region };
      atomicWrite(AWS_STATE_FILE, awsState);
      return;
    }

    const out = {
      ok: true,
      checkedAt,
      account: identity.value.Account,
      arn: identity.value.Arn,
      userId: identity.value.UserId,
      region,
      resources: {},
      nodes: [],
      errors: []
    };

    const calls = [
      ['ec2', ['ec2','describe-instances','--region',region,'--output','json'], ['Reservations']],
      ['vpcs', ['ec2','describe-vpcs','--region',region,'--output','json'], ['Vpcs']],
      ['enis', ['ec2','describe-network-interfaces','--region',region,'--output','json'], ['NetworkInterfaces']],
      ['lambdas', ['lambda','list-functions','--region',region,'--output','json'], ['Functions']],
      ['restApis', ['apigateway','get-rest-apis','--region',region,'--output','json'], ['items']],
      ['httpApis', ['apigatewayv2','get-apis','--region',region,'--output','json'], ['Items']],
      ['loadBalancers', ['elbv2','describe-load-balancers','--region',region,'--output','json'], ['LoadBalancers']],
      ['rds', ['rds','describe-db-instances','--region',region,'--output','json'], ['DBInstances']],
      ['stacks', ['cloudformation','list-stacks','--region',region,'--output','json'], ['StackSummaries']]
    ];

    for (const [name, args, p] of calls) {
      const r = await awsExec(args);
      if (r.ok) {
        out.resources[name] = r.value;
        const count = resourceCount(r.value, p);
        if (count && regionCoords[region]) {
          out.nodes.push({
            id: `aws:${region}:${name}`,
            type: 'aws-region',
            service: name,
            region,
            count,
            lat: regionCoords[region][0],
            lng: regionCoords[region][1],
            label: `${name} · ${region} · ${count}`
          });
        }
      } else {
        out.errors.push({ service: name, error: r.error });
      }
    }

    awsState = out;
    atomicWrite(AWS_STATE_FILE, awsState);
    lastAwsCheck = checkedAt;
  } finally {
    awsBusy = false;
  }
}



function angularDistanceRad(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}
function arcAltitudeFor(lat1, lng1, lat2, lng2) {
  const ang = angularDistanceRad(lat1, lng1, lat2, lng2);
  return Math.min(0.55, Math.max(0.08, 0.09 + (ang / Math.PI) * 0.48));
}
/** Skip local/same-city arcs (span ~0) that render as spikes into space. */
function arcTooShort(lat1, lng1, lat2, lng2) {
  return angularDistanceRad(lat1, lng1, lat2, lng2) < 0.02; // ~125 km
}
const ARC_COLOR_GREEN = ['#22c55e', '#86efac'];


function addPersistentHawaiiMainlandArc(arcs, origin, hawaiiFlows) {
  if (!origin || !Number.isFinite(origin.lat) || !Number.isFinite(origin.lng) || !hawaiiFlows?.size) return;
  let latest = null;
  for (const flow of hawaiiFlows.values()) {
    if (!flow?.source || !Number.isFinite(flow.source.lat) || !Number.isFinite(flow.source.lng)) continue;
    if (!latest || Number(flow.lastSeen || 0) > Number(latest.lastSeen || 0)) latest = flow;
  }
  if (!latest) return;

  const hLat = latest.source.lat;
  const hLng = latest.source.lng;
  if (arcTooShort(origin.lat, origin.lng, hLat, hLng)) return;

  const altitude = arcAltitudeFor(origin.lat, origin.lng, hLat, hLng);
  const animateMs = Math.max(
    600,
    Math.min(1600, 700 + angularDistanceRad(origin.lat, origin.lng, hLat, hLng) * 400)
  );

  const common = {
    color: ARC_COLOR_GREEN,
    stroke: 1.35,
    altitude,
    animateMs,
    process: 'Hawaii ↔ Mainland',
    protocol: 'persistent',
    port: null,
    ip: latest.source.ip || null,
    endpoint: 'Hawaii',
    city: null,
    country: 'United States',
    asn: latest.source.asn || null,
    org: latest.source.org || null,
    sourceNode: latest.sourceNode || 'HawaiiRoot',
    sourceRegion: latest.sourceRegion || 'local-hawaii',
    sourceLabel: latest.source.label || 'Hawaii'
  };

  arcs.push({
    ...common,
    startLat: origin.lat,
    startLng: origin.lng,
    endLat: hLat,
    endLng: hLng
  });

  arcs.push({
    ...common,
    startLat: hLat,
    startLng: hLng,
    endLat: origin.lat,
    endLng: origin.lng
  });
}

function buildPayload() {
  const now = Date.now();
  const arcs = [];
  const points = [];
  const pointKeys = new Set();

  if (origin?.lat != null && origin?.lng != null) {
    points.push({ lat: origin.lat, lng: origin.lng, type: 'origin', label: origin.label || 'Origin' });
    pointKeys.add(`o:${origin.lat.toFixed(3)},${origin.lng.toFixed(3)}`);
  }

  let totalPackets = 0;
  let totalBytes = 0;
  let mapped = 0;
  let hawaiiMapped = 0;
  pruneHawaiiFlows();
  addPersistentHawaiiMainlandArc(arcs, origin, hawaiiFlows);
  const endpointSet = new Set();
  for (const flow of currentFlows.values()) {
    const g = geoCache[flow.peer.ip];
    const stats = packetStatsForFlow(flow.key);
    totalPackets += stats.packets;
    totalBytes += stats.bytes;
    endpointSet.add(flow.peer.ip);
    if (!g?.lat || !Number.isFinite(g.lng) || !origin) continue;
    const pointKey = `r:${g.lat.toFixed(3)},${g.lng.toFixed(3)}`;
    if (!pointKeys.has(pointKey)) {
      pointKeys.add(pointKey);
      points.push({
        lat: g.lat, lng: g.lng, type: 'remote',
        label: `${g.city ? g.city + ', ' : ''}${g.country || 'Unknown'}${g.org ? ' · ' + g.org : ''}`
      });
    }
    const pps = stats.packets / (PACKET_WINDOW_MS / 1000);
    const bps = stats.bytes / (PACKET_WINDOW_MS / 1000);
    const processName = flow.process || 'network';
    if (arcTooShort(origin.lat, origin.lng, g.lat, g.lng)) continue;
    arcs.push({
      startLat: origin.lat, startLng: origin.lng,
      endLat: g.lat, endLng: g.lng,
      color: ARC_COLOR_GREEN,
      stroke: Math.max(0.7, Math.min(2.6, 0.9 + Math.log10(1 + packetsPerSecondSafe(pps)) * 0.85)),
      altitude: arcAltitudeFor(origin.lat, origin.lng, g.lat, g.lng),
      animateMs: Math.max(600, Math.min(1600, 700 + angularDistanceRad(origin.lat, origin.lng, g.lat, g.lng) * 400)),
      process: processName,
      protocol: flow.proto,
      port: flow.peer.port,
      ip: flow.peer.ip,
      endpoint: g.org || 'external network',
      city: g.city, country: g.country, asn: g.asn, org: g.org,
      packets: stats.packets, bytes: stats.bytes,
      packetsPerSec: pps, bytesPerSec: bps
    });
    mapped++;
  }


  for (const flow of hawaiiFlows.values()) {
    const g = geoCache[flow.peer.ip];
    totalPackets += flow.packets;
    totalBytes += flow.bytes;
    endpointSet.add(flow.peer.ip);
    if (!g?.lat || !Number.isFinite(g.lng)) continue;
    const pointKey = `r:${g.lat.toFixed(3)},${g.lng.toFixed(3)}`;
    if (!pointKeys.has(pointKey)) {
      pointKeys.add(pointKey);
      points.push({
        lat: g.lat, lng: g.lng, type: 'remote',
        label: `${g.city ? g.city + ', ' : ''}${g.country || 'Unknown'}${g.org ? ' · ' + g.org : ''}`
      });
    }
    const pps = flow.packets / (PACKET_WINDOW_MS / 1000);
    const bps = flow.bytes / (PACKET_WINDOW_MS / 1000);
    const processName = flow.process || 'network';
    if (arcTooShort(flow.source.lat, flow.source.lng, g.lat, g.lng)) continue;
    arcs.push({
      startLat: flow.source.lat, startLng: flow.source.lng,
      endLat: g.lat, endLng: g.lng,
      color: ARC_COLOR_GREEN,
      stroke: Math.max(0.7, Math.min(2.6, 0.9 + Math.log10(1 + packetsPerSecondSafe(pps)) * 0.85)),
      altitude: arcAltitudeFor(flow.source.lat, flow.source.lng, g.lat, g.lng),
      animateMs: Math.max(600, Math.min(1600, 700 + angularDistanceRad(flow.source.lat, flow.source.lng, g.lat, g.lng) * 400)),
      process: processName,
      protocol: flow.proto,
      port: flow.peer.port,
      ip: flow.peer.ip,
      endpoint: g.org || 'external network',
      city: g.city, country: g.country, asn: g.asn, org: g.org,
      packets: flow.packets, bytes: flow.bytes,
      packetsPerSec: pps, bytesPerSec: bps,
      sourceNode: flow.sourceNode,
      sourceRegion: flow.sourceRegion,
      sourceLabel: flow.source.label
    });
    hawaiiMapped++;
  }

  if (awsState.ok) {
    for (const n of awsState.nodes || []) {
      const key = `aws:${n.lat.toFixed(3)},${n.lng.toFixed(3)}:${n.service}`;
      if (!pointKeys.has(key)) {
        pointKeys.add(key);
        points.push({ lat: n.lat, lng: n.lng, type: 'aws', label: `AWS ${n.service} · ${n.region} · ${n.count}` });
      }
      if (origin?.lat != null) {
        arcs.push({
          startLat: origin.lat, startLng: origin.lng,
          endLat: n.lat, endLng: n.lng,
          color: ARC_COLOR_GREEN,
          stroke: 1.0,
          altitude: arcAltitudeFor(origin.lat, origin.lng, n.lat, n.lng),
          animateMs: Math.max(600, Math.min(1600, 700 + angularDistanceRad(origin.lat, origin.lng, n.lat, n.lng) * 400)),
          process: 'AWS',
          protocol: 'aws',
          port: null,
          endpoint: n.service,
          city: null,
          country: null,
          awsRegion: n.region,
          awsCount: n.count
        });
      }
    }
  }

  return {
    type: 'network-globe', version: 3, ts: now,
    origin,
    aws: {
      ok: awsState.ok,
      account: awsState.account || null,
      region: awsState.region || null,
      checkedAt: awsState.checkedAt || 0,
      resourceNodes: awsState.nodes?.length || 0,
      errors: awsState.errors || [],
      reason: awsState.reason || null
    },
    arcs, points,
    stats: {
      activeFlows: currentFlows.size + hawaiiFlows.size,
      localActiveFlows: currentFlows.size,
      hawaiiActiveFlows: hawaiiFlows.size,
      mappedFlows: mapped + hawaiiMapped,
      localMappedFlows: mapped,
      hawaiiMappedFlows: hawaiiMapped,
      endpoints: endpointSet.size,
      packetRate: Number((totalPackets / (PACKET_WINDOW_MS / 1000)).toFixed(1)),
      bytesPerSec: Math.round(totalBytes / (PACKET_WINDOW_MS / 1000)),
      geoQueue: geoQueue.length,
      geoCached: Object.keys(geoCache).filter(k => geoCache[k]?.lat != null).length,
      collector: collectorStarted ? 'ss + tcpdump' : 'ss',
      hawaiiCollector: 'ssh ndjson stream',
      hostname: os.hostname(),
      updated: now
    }
  };
}

function packetsPerSecondSafe(v) { return Number.isFinite(v) ? v : 0; }

function publish() {
  lastPayload = buildPayload();
  atomicWrite(STATE_FILE, lastPayload);
  history.push({
    ts: lastPayload.ts,
    stats: lastPayload.stats,
    origin: lastPayload.origin,
    aws: lastPayload.aws,
    arcs: lastPayload.arcs.map(a => ({
      ip: a.ip, city: a.city, country: a.country, org: a.org,
      process: a.process, protocol: a.protocol, port: a.port,
      packets: a.packets || 0, bytes: a.bytes || 0,
      awsRegion: a.awsRegion || null, awsCount: a.awsCount || null,
      sourceNode: a.sourceNode || null, sourceRegion: a.sourceRegion || null, sourceLabel: a.sourceLabel || null
    }))
  });
  if (history.length > HISTORY_LIMIT) history.splice(0, history.length - HISTORY_LIMIT);
  atomicWrite(HISTORY_FILE, history);
}

async function collectOnce() {
  await refreshLocalAddresses();
  const rows = await runSs();
  updateFlows(rows);
  publish();
}

async function boot() {
  await refreshLocalAddresses();
  await discoverOrigin();
  startTcpdump();
  await refreshAws();
  await collectOnce();
  pollHawaii();
  setInterval(() => { collectOnce().catch(() => {}); }, POLL_MS);
  setInterval(() => { pollHawaii(); }, HAWAII_POLL_MS);
  setInterval(() => { refreshAws().catch(() => {}); }, AWS_POLL_MS);
  console.log('');
  console.log('Live Network Globe');
  console.log(`→ http://${HOST}:${PORT}`);
  console.log(`→ data: ${DATA_DIR}`);
  console.log(`→ AWS region: ${awsState.region || process.env.AWS_REGION || 'unknown'}`);
  console.log(`→ collector: ${collectorStarted ? 'ss + tcpdump' : 'ss'}`);
  console.log(`→ Hawaii stream: ${HAWAII_FILE}`);
  console.log('');
}

server.listen(PORT, HOST, boot);

function shutdown() {
  try { if (tcpdumpProc) tcpdumpProc.kill('SIGTERM'); } catch {}
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
