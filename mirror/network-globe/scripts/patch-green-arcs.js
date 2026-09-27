#!/usr/bin/env node
/** One-shot: solid green arcs + geodesic altitude + persistent Hawaii/mainland connection. */
const fs = require('fs');
const path = process.argv[2] || require('path').join(__dirname, '..', 'server.js');
let t = fs.readFileSync(path, 'utf8');

// Keep the last Hawaii-observed connection visible for five minutes after disconnect.
t = t.replace(/const HAWAII_FLOW_TTL_MS = Number\(process\.env\.HAWAII_FLOW_TTL_MS \|\| [^;]+\);/, 'const HAWAII_FLOW_TTL_MS = Number(process.env.HAWAII_FLOW_TTL_MS || 5 * 60 * 1000);');

const helper = `
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

`;

if (!t.includes('function buildPayload()')) {
  console.error('buildPayload not found');
  process.exit(1);
}

// Idempotent: strip previous helper block if re-run
if (t.includes('function arcAltitudeFor')) {
  t = t.replace(/\nfunction angularDistanceRad[\s\S]*?const ARC_COLOR_GREEN = \[[^\]]+\];\n\n/, '\n');
}
t = t.replace('function buildPayload() {', helper + 'function buildPayload() {');

t = t.replace(
  /color: processName\.includes\('git'\) \? \['#60a5fa','#ffffff'\] : processName\.includes\('megasync'\) \? \['#a78bfa','#ffffff'\] : \['#ff6b9d','#ffffff'\],/g,
  'color: ARC_COLOR_GREEN,'
);
t = t.replace(/color: ARC_COLOR_GREEN,/g, 'color: ARC_COLOR_GREEN,');
t = t.replace(/color: \['#38bdf8','#ffffff'\],/g, 'color: ARC_COLOR_GREEN,');
t = t.replace(/color: \['#22c55e', '#86efac'\],/g, 'color: ARC_COLOR_GREEN,');

// Local (origin → peer) arcs: insert short-span skip before arcs.push
if (!t.includes('arcTooShort(origin.lat')) {
  t = t.replace(
    /const processName = flow\.process \|\| 'network';\n    arcs\.push\(\{\n      startLat: origin\.lat, startLng: origin\.lng,/,
    `const processName = flow.process || 'network';
    if (arcTooShort(origin.lat, origin.lng, g.lat, g.lng)) continue;
    arcs.push({
      startLat: origin.lat, startLng: origin.lng,`
  );
}

// Hawaii observed-flow arcs
if (!t.includes('arcTooShort(flow.source.lat')) {
  t = t.replace(
    /const processName = flow\.process \|\| 'network';\n    arcs\.push\(\{\n      startLat: flow\.source\.lat, startLng: flow\.source\.lng,/,
    `const processName = flow.process || 'network';
    if (arcTooShort(flow.source.lat, flow.source.lng, g.lat, g.lng)) continue;
    arcs.push({
      startLat: flow.source.lat, startLng: flow.source.lng,`
  );
}

// Persistent Hawaii ↔ mainland anchor. Any Hawaii observation within the five-minute
// Hawaii flow TTL keeps this green bidirectional connection alive. New observations
// refresh lastSeen in hawaiiFlows, so the five-minute window continuously rolls forward.
if (!t.includes('function addPersistentHawaiiMainlandArc')) {
  const persistentHelper = `
function addPersistentHawaiiMainlandArc(arcs, origin, hawaiiFlows) {
  if (!origin?.lat || !Number.isFinite(origin.lng) || !hawaiiFlows?.size) return;
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
  const animateMs = Math.max(600, Math.min(1600, 700 + angularDistanceRad(origin.lat, origin.lng, hLat, hLng) * 400));
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
  arcs.push({ ...common, startLat: origin.lat, startLng: origin.lng, endLat: hLat, endLng: hLng });
  arcs.push({ ...common, startLat: hLat, startLng: hLng, endLat: origin.lat, endLng: origin.lng });
}
`;
  t = t.replace('function buildPayload() {', persistentHelper + 'function buildPayload() {');
}

const anchorCall = '  addPersistentHawaiiMainlandArc(arcs, origin, hawaiiFlows);\n';
if (!t.includes(anchorCall)) {
  t = t.replace('  pruneHawaiiFlows();\n', '  pruneHawaiiFlows();\n' + anchorCall);
}

t = t.replace(
  /altitude: 0\.12 \+ Math\.min\(0\.28, Math\.abs\(g\.lat - origin\.lat\) \/ 350\),/g,
  'altitude: arcAltitudeFor(origin.lat, origin.lng, g.lat, g.lng),\n      animateMs: Math.max(600, Math.min(1600, 700 + angularDistanceRad(origin.lat, origin.lng, g.lat, g.lng) * 400)),'
);
t = t.replace(
  /altitude: 0\.12 \+ Math\.min\(0\.28, Math\.abs\(g\.lat - flow\.source\.lat\) \/ 350\),/g,
  'altitude: arcAltitudeFor(flow.source.lat, flow.source.lng, g.lat, g.lng),\n      animateMs: Math.max(600, Math.min(1600, 700 + angularDistanceRad(flow.source.lat, flow.source.lng, g.lat, g.lng) * 400)),'
);
t = t.replace(
  /stroke: Math\.max\(0\.35, Math\.min\(2\.4, 0\.5 \+ Math\.log10\(1 \+ packetsPerSecondSafe\(pps\)\) \* 0\.8\)\),/g,
  'stroke: Math.max(0.7, Math.min(2.6, 0.9 + Math.log10(1 + packetsPerSecondSafe(pps)) * 0.85)),'
);
t = t.replace(
  /stroke: 0\.85,\n          altitude: 0\.22,/g,
  'stroke: 1.0,\n          altitude: arcAltitudeFor(origin.lat, origin.lng, n.lat, n.lng),\n          animateMs: Math.max(600, Math.min(1600, 700 + angularDistanceRad(origin.lat, origin.lng, n.lat, n.lng) * 400)),'
);

fs.writeFileSync(path, t);
console.log('patched', path);
