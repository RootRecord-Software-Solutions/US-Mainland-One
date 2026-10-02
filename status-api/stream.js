'use strict';

// One station. One encoder. Listeners join this live mix.
// Music stays open underneath reports and chimes.
// A Hawaii :00 or :30 chime holds the report decoder and then resumes it.
// A new report file never restarts this process. Code activation waits
// until no report and no chime are in progress, then exits 75.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 8092);
const AUDIO = process.env.RADIO_DIR || '/home/ubuntu/rootrecord-radio/audio';
const REPORTS = process.env.RADIO_REPORTS_DIR || path.join(AUDIO, 'reports');
const HEARTBEAT = process.env.RADIO_HEARTBEAT || '/home/ubuntu/rootrecord-radio/state/heartbeat';
const DEPLOY_FILE = process.env.RADIO_DEPLOY_PENDING || '/home/ubuntu/rootrecord-radio/deploy-pending';
const RELEASE = process.env.RADIO_RELEASE || '';
process.env.RADIO_DIR = AUDIO;
process.env.RADIO_REPORTS_DIR = REPORTS;

const radio = require(process.env.RADIO_LIB || path.join(__dirname, 'radio'));

const RATE = 44100;
const FRAME = RATE * 2 * 2 / 10;
const OPEN_MS = Number(process.env.RADIO_OPEN_MS || 12000);
const GAP_MS = Number(process.env.RADIO_GAP_MS || 10 * 60 * 1000);
const SCAN_MS = Number(process.env.RADIO_SCAN_MS || 5000);
const DUCK = 0.25;
const DEPLOY_EXIT = 75;

const TITLES = {
  nws_weather: 'NWS Hawaiʻi',
  official_weather: 'Official weather',
  hurricane_desk: 'Hurricane',
  kilauea_report: 'Kīlauea',
  earthquake_report: 'Earthquake',
  energy_report: 'Energy',
  solar_desk: 'Solar',
  bandwidth_desk: 'Bandwidth',
  security_desk: 'Security',
  system_perf: 'Systems',
  morning_report: 'Morning',
  midday_report: 'Midday',
  late_report: 'Late',
  remaining_tasks: 'Tasks',
  boot_brief: 'Boot',
  current_report: 'Current',
  news_update: 'News'
};

const now = {
  music: '',
  description: '',
  report: ''
};

const station = {
  phase: 'NORMAL',
  report: 'NONE',
  playing: null,
  pending: null,
  chimeSlot: '',
  chimeMissing: '',
  deferredSha: ''
};

const clients = new Set();
const preroll = [];
let prerollBytes = 0;
let encoder = null;
let musicProc = null;
let reportProc = null;
let chimeProc = null;
let stopped = false;
let tracks = [];
let order = [];
let orderAt = 0;
let lastTrack = '';
let reports = [];
let seen = {};
let primed = false;
let updates = [];
let rotation = [];
let rotAt = 0;
let gapTimer = null;
let opened = false;
let paced = 0;
let paceAt = Date.now();
let lastBeat = 0;

function log(event, fields) {
  const parts = ['event=' + event, 'at=' + Date.now()];
  const data = fields || {};
  for (const key of Object.keys(data)) {
    parts.push(key + '=' + String(data[key]).replace(/\s+/g, '_'));
  }
  console.log(parts.join(' '));
}

function titleOf(id) {
  return TITLES[id] || String(id || '').replace(/_/g, ' ');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stationNow() {
  const file = process.env.RADIO_CLOCK_FILE;
  if (file) {
    try {
      const parsed = new Date(fs.readFileSync(file, 'utf8').trim());
      if (!Number.isNaN(parsed.getTime())) return parsed;
    } catch (err) {}
  }
  return new Date();
}

function hawaiiClock(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Pacific/Honolulu',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date || new Date());
  const clock = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 };
  for (const part of parts) {
    if (part.type === 'year') clock.year = Number(part.value);
    if (part.type === 'month') clock.month = Number(part.value);
    if (part.type === 'day') clock.day = Number(part.value);
    if (part.type === 'hour') clock.hour = Number(part.value) % 24;
    if (part.type === 'minute') clock.minute = Number(part.value);
    if (part.type === 'second') clock.second = Number(part.value);
  }
  clock.date = clock.year + '-' + pad(clock.month) + '-' + pad(clock.day);
  return clock;
}

function pad(n) {
  return (n < 10 ? '0' : '') + n;
}

function shuffle(list) {
  const copy = list.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const swap = copy[i];
    copy[i] = copy[j];
    copy[j] = swap;
  }
  return copy;
}

function inside(root, name) {
  const base = path.resolve(root);
  const full = path.resolve(root, name);
  if (full !== base && !full.startsWith(base + path.sep)) return '';
  return full;
}

function closeProc(proc) {
  if (!proc) return;
  try { proc.stdout.destroy(); } catch (err) {}
  try { proc.kill('SIGKILL'); } catch (err) {}
}

function openDecode(file) {
  return spawn('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-i', file,
    '-f', 's16le', '-ar', String(RATE), '-ac', '2',
    '-flush_packets', '1',
    'pipe:1'
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
}

function Decoder(file) {
  this.proc = openDecode(file);
  this.buf = Buffer.alloc(0);
  this.closed = false;
  this.file = file;
  const self = this;
  this.proc.stdout.on('data', (chunk) => {
    self.buf = self.buf.length ? Buffer.concat([self.buf, chunk]) : chunk;
    if (self.buf.length > FRAME * 40 && !self.proc.stdout.isPaused()) self.proc.stdout.pause();
  });
  this.proc.stdout.on('end', () => { self.closed = true; });
  this.proc.stdout.on('error', () => { self.closed = true; });
  this.proc.stderr.on('data', (chunk) => {
    const text = String(chunk || '').trim();
    if (text) log('decoder_error', { pid: self.proc.pid, detail: text.slice(0, 180) });
  });
  this.proc.on('exit', (code) => {
    self.closed = true;
    if (code && !stopped) log('decoder_exit', { pid: self.proc.pid, code: code });
  });
}

Decoder.prototype.stop = function () {
  closeProc(this.proc);
  this.closed = true;
  this.buf = Buffer.alloc(0);
};

Decoder.prototype.take = function () {
  if (this.proc.stdout && this.proc.stdout.isPaused() && this.buf.length < FRAME * 15) {
    try { this.proc.stdout.resume(); } catch (err) {}
  }
  if (this.buf.length < FRAME) {
    if (!this.closed) return null;
    if (!this.buf.length) return { ended: true };
    const padded = Buffer.alloc(FRAME);
    this.buf.copy(padded);
    this.buf = Buffer.alloc(0);
    return { pcm: padded, ended: true };
  }
  const pcm = Buffer.from(this.buf.subarray(0, FRAME));
  this.buf = Buffer.from(this.buf.subarray(FRAME));
  return { pcm, ended: false };
};

function startEncoder() {
  if (encoder && encoder.exitCode == null && !encoder.killed) return;
  encoder = spawn('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-f', 's16le', '-ar', String(RATE), '-ac', '2', '-i', 'pipe:0',
    '-c:a', 'libmp3lame', '-b:a', '128k',
    '-f', 'mp3', '-write_xing', '0', '-flush_packets', '1',
    'pipe:1'
  ], { stdio: ['pipe', 'pipe', 'pipe'] });
  log('encoder_up', { pid: encoder.pid });
  encoder.stdout.on('data', (chunk) => {
    preroll.push(chunk);
    prerollBytes += chunk.length;
    while (prerollBytes > 32768 && preroll.length > 1) prerollBytes -= preroll.shift().length;
    for (const res of clients) {
      if (res.writableEnded || res.destroyed) {
        clients.delete(res);
        continue;
      }
      if (res.writableLength > 1024 * 1024) continue;
      try { res.write(chunk); } catch (err) { clients.delete(res); }
    }
  });
  encoder.stderr.on('data', (chunk) => {
    const text = String(chunk || '').trim();
    if (text) log('encoder_error', { detail: text.slice(0, 180) });
  });
  encoder.on('exit', (code) => {
    if (stopped) return;
    log('encoder_down', { code: code });
    encoder = null;
    setTimeout(startEncoder, 400);
  });
}

function voiceActive() {
  return station.phase === 'CHIME' || station.report === 'ACTIVE';
}

function mix(music, voice) {
  const out = Buffer.alloc(FRAME);
  const gain = voiceActive() ? DUCK : 1;
  for (let i = 0; i < FRAME; i += 2) {
    let sample = music.readInt16LE(i) * gain;
    if (voice) sample += voice.readInt16LE(i);
    if (sample > 32767) sample = 32767;
    if (sample < -32768) sample = -32768;
    out.writeInt16LE(sample | 0, i);
  }
  return out;
}

function writePcm(buf) {
  return new Promise((resolve) => {
    if (!encoder || !encoder.stdin || !encoder.stdin.writable) {
      resolve(false);
      return;
    }
    if (encoder.stdin.write(buf)) {
      resolve(true);
      return;
    }
    encoder.stdin.once('drain', () => resolve(true));
  });
}

function queued(list, id) {
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === id) return i;
  }
  return -1;
}

function reportPath(name) {
  return inside(REPORTS, name);
}

function fileIdent(file) {
  const st = fs.statSync(file);
  return st.dev + ':' + st.ino + ':' + st.size + ':' + Math.floor(st.mtimeMs);
}

function beginReport(item) {
  const file = reportPath(item.file);
  if (!file || !fs.existsSync(file)) return;
  let ident = '';
  try {
    ident = fileIdent(file);
  } catch (err) {
    log('report_skip', { id: item.id, detail: 'stat' });
    return;
  }
  if (reportProc) reportProc.stop();
  station.report = 'ACTIVE';
  station.playing = { id: item.id, file: item.file, ident: ident, at: Date.now() };
  station.pending = null;
  now.report = titleOf(item.id);
  reportProc = new Decoder(file);
  station.playing.pid = reportProc.proc.pid;
  log('report_start', { id: item.id, ident: ident, pid: station.playing.pid });
}

function finishReport() {
  if (!station.playing) return;
  if (station.phase === 'CHIME' && station.report === 'HELD') return;
  const done = station.playing;
  const elapsed = ((Date.now() - (done.at || Date.now())) / 1000).toFixed(1);
  station.playing = null;
  station.report = 'NONE';
  now.report = '';
  if (reportProc) reportProc.stop();
  reportProc = null;
  log('report_end', { id: done.id, ident: done.ident, pid: done.pid, seconds: elapsed });
  const again = station.pending;
  station.pending = null;
  if (again && again.id === done.id && eligible(again.id)) {
    beginReport(again);
    return;
  }
  pump();
}

function eligible(id) {
  for (const row of reports) {
    if (row.id === id) return true;
  }
  return false;
}

function enqueueUpdate(item) {
  if (station.playing && station.playing.id === item.id) {
    if (item.ident !== station.playing.ident) {
      station.pending = item;
      log('report_replacement', { id: item.id, ident: item.ident });
    }
    return;
  }
  const at = queued(updates, item.id);
  if (at >= 0) {
    if (item.ident !== updates[at].ident) updates[at] = item;
    return;
  }
  rotation = rotation.filter((row) => row.id !== item.id);
  updates.push(item);
  log('queue_add', { id: item.id, ident: item.ident });
  if (station.report === 'NONE' && station.phase !== 'CHIME') pump();
}

function enqueueRotation() {
  if (!reports.length) return;
  let item = reports[rotAt % reports.length];
  rotAt += 1;
  if (station.playing && station.playing.id === item.id) {
    if (reports.length < 2) return;
    item = reports[rotAt % reports.length];
    rotAt += 1;
  }
  if (queued(updates, item.id) >= 0 || queued(rotation, item.id) >= 0) return;
  rotation.push(item);
}

function pump() {
  if (station.report !== 'NONE' || station.phase === 'CHIME') return;
  if (updates.length) {
    clearTimeout(gapTimer);
    gapTimer = null;
    beginReport(updates.shift());
    return;
  }
  if (rotation.length) {
    clearTimeout(gapTimer);
    gapTimer = null;
    beginReport(rotation.shift());
    return;
  }
  if (!gapTimer) armGap();
}

function armGap() {
  if (gapTimer || station.report !== 'NONE' || station.phase === 'CHIME' || updates.length || rotation.length) return;
  const wait = opened ? GAP_MS : OPEN_MS;
  opened = true;
  gapTimer = setTimeout(() => {
    gapTimer = null;
    enqueueRotation();
    pump();
  }, wait);
}

function enrich(row) {
  const file = reportPath(row.file);
  if (!file) return null;
  let ident = '';
  try {
    ident = fileIdent(file);
  } catch (err) {
    return null;
  }
  return { id: row.id, file: row.file, ident: ident };
}

function applyCatalog(data) {
  tracks = (data.music || []).filter((row) => row && row.name);
  const live = {};
  const next = [];
  for (const row of data.reports || []) {
    if (!row || !row.id || !row.file) continue;
    const item = enrich(row);
    if (!item) continue;
    next.push(item);
    live[item.id] = item;
  }
  reports = next;
  updates = updates.filter((row) => live[row.id]);
  rotation = rotation.filter((row) => live[row.id]);
  if (station.pending && !live[station.pending.id]) station.pending = null;
  if (!primed) {
    for (const row of reports) seen[row.id] = row.ident;
    primed = true;
    return;
  }
  for (const row of reports) {
    const prev = seen[row.id];
    if (prev == null || row.ident !== prev) {
      enqueueUpdate(row);
      seen[row.id] = row.ident;
    }
  }
  for (const id of Object.keys(seen)) {
    if (!live[id]) delete seen[id];
  }
}

function scan() {
  try {
    applyCatalog(radio.catalog(stationNow()));
  } catch (err) {
    log('catalog_error', { detail: err.message });
  }
}

function ensureMusic() {
  if (musicProc) return;
  if (!tracks.length) return;
  if (orderAt >= order.length) {
    order = shuffle(tracks);
    orderAt = 0;
    if (order.length > 1 && order[0].name === lastTrack) {
      const first = order[0];
      order[0] = order[1];
      order[1] = first;
    }
  }
  const row = order[orderAt++];
  const file = inside(path.join(AUDIO, 'music'), row.name);
  if (!file || !fs.existsSync(file)) return;
  lastTrack = row.name;
  now.music = row.title || row.name.replace(/\.mp3$/i, '');
  now.description = row.description || '';
  musicProc = new Decoder(file);
  log('music_start', { pid: musicProc.proc.pid, title: now.music });
}

function maybeChime() {
  if (station.phase === 'CHIME') return;
  const clock = hawaiiClock(stationNow());
  if (clock.minute !== 0 && clock.minute !== 30) return;
  const slot = clock.date + 'T' + pad(clock.hour) + ':' + pad(clock.minute);
  if (slot === station.chimeSlot) return;
  const file = inside(path.join(AUDIO, 'chimes'), 'hour-' + pad(clock.hour) + '-' + pad(clock.minute) + '.wav');
  if (!file || !fs.existsSync(file)) {
    if (station.chimeMissing !== slot) {
      station.chimeMissing = slot;
      log('chime_missing', { slot: slot });
    }
    return;
  }
  station.chimeSlot = slot;
  station.phase = 'CHIME';
  if (station.report === 'ACTIVE' && reportProc && station.playing) {
    station.report = 'HELD';
    log('report_held', { id: station.playing.id, pid: station.playing.pid });
  }
  chimeProc = new Decoder(file);
  log('chime_start', { slot: slot, pid: chimeProc.proc.pid });
}

function endChime() {
  const slot = station.chimeSlot;
  if (chimeProc) chimeProc.stop();
  chimeProc = null;
  station.phase = 'NORMAL';
  log('chime_end', { slot: slot });
  if (station.report === 'HELD' && station.playing) {
    station.report = 'ACTIVE';
    log('report_resumed', { id: station.playing.id, pid: station.playing.pid });
  }
}

function beat() {
  const nowMs = Date.now();
  if (nowMs - lastBeat < 1000) return;
  lastBeat = nowMs;
  try {
    fs.mkdirSync(path.dirname(HEARTBEAT), { recursive: true });
    const tmp = HEARTBEAT + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({
      at: nowMs,
      phase: station.phase,
      report: station.report,
      pid: process.pid
    }));
    fs.renameSync(tmp, HEARTBEAT);
  } catch (err) {}
}

function busy() {
  return station.phase === 'CHIME' || station.report === 'ACTIVE' || station.report === 'HELD';
}

function considerDeploy() {
  let sha = '';
  try {
    sha = fs.readFileSync(DEPLOY_FILE, 'utf8').trim();
  } catch (err) {
    return;
  }
  if (!sha || sha === RELEASE) return;
  if (busy()) {
    if (station.deferredSha !== sha) {
      station.deferredSha = sha;
      log('deploy_deferred', { sha: sha, reason: station.phase === 'CHIME' ? 'chime' : 'report' });
    }
    return;
  }
  log('deploy_activate', { sha: sha });
  shutdown(DEPLOY_EXIT, 'deploy_activate');
}

async function step() {
  maybeChime();
  if (station.report === 'NONE' && station.phase !== 'CHIME') pump();
  ensureMusic();
  let musicPcm = Buffer.alloc(FRAME);
  if (musicProc) {
    const frame = musicProc.take();
    if (frame && frame.pcm) musicPcm = frame.pcm;
    if (frame && frame.ended) {
      musicProc.stop();
      musicProc = null;
    }
  }
  let voice = null;
  if (station.phase === 'CHIME' && chimeProc) {
    const frame = chimeProc.take();
    if (frame && frame.pcm) voice = frame.pcm;
    if (frame && frame.ended) endChime();
  } else if (station.report === 'ACTIVE' && reportProc) {
    const frame = reportProc.take();
    if (frame && frame.pcm) voice = frame.pcm;
    if (frame && frame.ended) {
      reportProc.stop();
      reportProc = null;
      finishReport();
    }
  }
  await writePcm(mix(musicPcm, voice));
  beat();
  considerDeploy();
  paced += 1;
  const wait = (paced * 100) - (Date.now() - paceAt);
  if (wait > 4) await sleep(wait);
}

async function loop() {
  while (!stopped) {
    try {
      await step();
    } catch (err) {
      log('step_error', { detail: err.message });
      await sleep(200);
    }
  }
}

function shutdown(code, reason) {
  if (stopped) return;
  stopped = true;
  log('station_exit', { reason: reason || 'stop', code: code });
  clearTimeout(gapTimer);
  if (musicProc) musicProc.stop();
  if (reportProc) reportProc.stop();
  if (chimeProc) chimeProc.stop();
  if (encoder) {
    try { encoder.stdin.end(); } catch (err) {}
    try { encoder.kill('SIGKILL'); } catch (err) {}
  }
  process.exit(code);
}

process.on('SIGTERM', () => shutdown(0, 'SIGTERM'));
process.on('SIGINT', () => shutdown(0, 'SIGINT'));

function nowBody() {
  return {
    ok: true,
    music: now.music,
    description: now.description,
    report: station.phase === 'CHIME' ? 'Time' : now.report,
    chime: station.phase === 'CHIME',
    duck: voiceActive() ? DUCK : 1,
    phase: station.phase,
    reportState: station.report,
    musicPid: musicProc && musicProc.proc ? musicProc.proc.pid : 0,
    listeners: clients.size
  };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD' });
    res.end('Method not allowed\n');
    return;
  }
  if (url.pathname === '/health') {
    const body = JSON.stringify({
      ok: true,
      encoder: !!(encoder && encoder.exitCode == null),
      phase: station.phase,
      report: station.report
    });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
    res.end(body);
    return;
  }
  if (url.pathname === '/radio/now.json' || url.pathname === '/now.json') {
    const body = JSON.stringify(nowBody());
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Content-Length': Buffer.byteLength(body)
    });
    res.end(body);
    return;
  }
  if (url.pathname === '/radio/live.mp3' || url.pathname === '/live.mp3') {
    res.writeHead(200, {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'X-Content-Type-Options': 'nosniff'
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    if (res.socket) {
      res.socket.setTimeout(0);
      res.socket.setNoDelay(true);
    }
    for (const chunk of preroll) res.write(chunk);
    clients.add(res);
    const drop = () => clients.delete(res);
    req.on('close', drop);
    res.on('error', drop);
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found\n');
});

server.requestTimeout = 0;
server.headersTimeout = 0;
server.timeout = 0;
server.keepAliveTimeout = 0;

server.listen(PORT, HOST, () => {
  log('station_start', { pid: process.pid, release: RELEASE || 'live', port: PORT });
  startEncoder();
  scan();
  setInterval(scan, SCAN_MS);
  armGap();
  loop();
});
