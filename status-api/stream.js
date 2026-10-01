'use strict';

// One station. One encoder. Listeners join this live mix.
// Music loops. A report ducks the music and plays through.
// A Hawaii :00 or :30 chime pauses that report, then the report continues.
// Nothing here skips because a browser connected.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 8092);
const AUDIO = process.env.RADIO_DIR || '/home/ubuntu/rootrecord-radio/audio';
const REPORTS = process.env.RADIO_REPORTS_DIR || path.join(AUDIO, 'reports');
process.env.RADIO_DIR = AUDIO;
process.env.RADIO_REPORTS_DIR = REPORTS;

const radio = require(process.env.RADIO_LIB || '/home/ubuntu/US-Mainland-Server/status-api/radio');

const RATE = 44100;
const FRAME = RATE * 2 * 2 / 10;
const OPEN_MS = 12000;
const GAP_MS = 10 * 60 * 1000;
const DUCK = 0.25;

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
  current_report: 'Current'
};

const now = {
  music: '',
  description: '',
  report: '',
  chime: false
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
let playing = null;
let replay = null;
let gapTimer = null;
let opened = false;
let chimeSlot = '';
let chimeOn = false;
let reportHeld = false;
let paced = 0;
let paceAt = Date.now();

function titleOf(id) {
  return TITLES[id] || String(id || '').replace(/_/g, ' ');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hawaiiClock(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Pacific/Honolulu',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date || new Date());
  const clock = { hour: 0, minute: 0, second: 0 };
  for (const part of parts) {
    if (part.type === 'hour') clock.hour = Number(part.value) % 24;
    if (part.type === 'minute') clock.minute = Number(part.value);
    if (part.type === 'second') clock.second = Number(part.value);
  }
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
    'pipe:1'
  ], { stdio: ['ignore', 'pipe', 'ignore'] });
}

function startEncoder() {
  if (encoder && encoder.exitCode == null && !encoder.killed) return;
  encoder = spawn('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-f', 's16le', '-ar', String(RATE), '-ac', '2', '-i', 'pipe:0',
    '-c:a', 'libmp3lame', '-b:a', '128k',
    '-f', 'mp3', '-write_xing', '0', '-flush_packets', '1',
    'pipe:1'
  ], { stdio: ['pipe', 'pipe', 'ignore'] });
  encoder.stdout.on('data', (chunk) => {
    preroll.push(chunk);
    prerollBytes += chunk.length;
    while (prerollBytes > 32768 && preroll.length > 1) prerollBytes -= preroll.shift().length;
    for (const res of clients) {
      if (res.writableLength > 1024 * 1024) {
        clients.delete(res);
        res.end();
        continue;
      }
      try { res.write(chunk); } catch (err) { clients.delete(res); }
    }
  });
  encoder.on('exit', () => {
    if (stopped) return;
    encoder = null;
    setTimeout(startEncoder, 400);
  });
}

function readExact(stream, n) {
  return new Promise((resolve) => {
    if (!stream || stream.readableEnded || stream.destroyed) {
      resolve(null);
      return;
    }
    const chunks = [];
    let got = 0;
    let settled = false;
    const finish = (ended) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stream.removeListener('readable', onReadable);
      stream.removeListener('end', onEnd);
      stream.removeListener('close', onEnd);
      if (!got) {
        resolve(null);
        return;
      }
      const buf = Buffer.concat(chunks);
      if (buf.length < n) {
        const padded = Buffer.alloc(n);
        buf.copy(padded);
        resolve({ pcm: padded, ended: true });
        return;
      }
      resolve({ pcm: buf.subarray(0, n), ended: ended });
    };
    const onEnd = () => finish(true);
    const onReadable = () => {
      let piece;
      while (got < n && (piece = stream.read(n - got))) {
        chunks.push(piece);
        got += piece.length;
      }
      if (got >= n) finish(false);
    };
    const timer = setTimeout(() => finish(true), 8000);
    onReadable();
    if (settled) return;
    stream.on('readable', onReadable);
    stream.on('end', onEnd);
    stream.on('close', onEnd);
  });
}

function mix(music, voice) {
  const out = Buffer.alloc(FRAME);
  const gain = voice ? DUCK : 1;
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

function beginReport(item) {
  const file = reportPath(item.file);
  if (!file || !fs.existsSync(file)) return;
  closeProc(reportProc);
  playing = { id: item.id, file: item.file, mtime: item.mtime };
  now.report = titleOf(item.id);
  reportProc = openDecode(file);
  console.log('report ' + item.id);
}

function finishReport() {
  if (!playing) return;
  if (chimeOn && reportHeld) return;
  const done = playing;
  playing = null;
  now.report = '';
  closeProc(reportProc);
  reportProc = null;
  if (replay && replay.id === done.id && replay.mtime > done.mtime) {
    const again = replay;
    replay = null;
    beginReport(again);
    return;
  }
  replay = null;
  pump();
}

function enqueueUpdate(item) {
  if (playing && playing.id === item.id) {
    if (item.mtime > playing.mtime) replay = item;
    return;
  }
  const at = queued(updates, item.id);
  if (at >= 0) {
    if (item.mtime >= updates[at].mtime) updates[at] = item;
    return;
  }
  rotation = rotation.filter((row) => row.id !== item.id);
  updates.push(item);
  if (!playing && !chimeOn) pump();
}

function enqueueRotation() {
  if (!reports.length) return;
  let item = reports[rotAt % reports.length];
  rotAt += 1;
  if (playing && playing.id === item.id) {
    if (reports.length < 2) return;
    item = reports[rotAt % reports.length];
    rotAt += 1;
  }
  if (queued(updates, item.id) >= 0 || queued(rotation, item.id) >= 0) return;
  rotation.push(item);
}

function pump() {
  if (playing || chimeOn) return;
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
  if (gapTimer || playing || chimeOn || updates.length || rotation.length) return;
  const wait = opened ? GAP_MS : OPEN_MS;
  opened = true;
  gapTimer = setTimeout(() => {
    gapTimer = null;
    enqueueRotation();
    pump();
  }, wait);
}

function applyCatalog(data) {
  tracks = (data.music || []).filter((row) => row && row.name);
  reports = (data.reports || []).filter((row) => row && row.id && row.file);
  const live = {};
  for (const row of reports) live[row.id] = true;
  updates = updates.filter((row) => live[row.id]);
  rotation = rotation.filter((row) => live[row.id]);
  if (!primed) {
    for (const row of reports) seen[row.id] = row.mtime;
    primed = true;
    return;
  }
  for (const row of reports) {
    const prev = seen[row.id];
    if (prev == null || row.mtime > prev) {
      enqueueUpdate(row);
      seen[row.id] = row.mtime;
    }
  }
  for (const id of Object.keys(seen)) {
    if (!live[id]) delete seen[id];
  }
}

function scan() {
  try {
    applyCatalog(radio.catalog());
  } catch (err) {
    console.log('catalog ' + err.message);
  }
}

function ensureMusic() {
  if (musicProc && musicProc.exitCode == null && !musicProc.killed) return;
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
  closeProc(musicProc);
  musicProc = openDecode(file);
  console.log('music ' + now.music);
}

function maybeChime() {
  if (chimeOn) return;
  const clock = hawaiiClock(new Date());
  if (clock.minute !== 0 && clock.minute !== 30) return;
  const slot = pad(clock.hour) + '-' + pad(clock.minute);
  if (slot === chimeSlot) return;
  const file = inside(path.join(AUDIO, 'chimes'), 'hour-' + slot + '.wav');
  chimeSlot = slot;
  if (!file || !fs.existsSync(file)) return;
  chimeOn = true;
  reportHeld = !!(playing && reportProc);
  now.chime = true;
  chimeProc = openDecode(file);
  console.log('chime ' + slot);
}

async function step() {
  maybeChime();
  if (!playing && !chimeOn) pump();
  ensureMusic();
  const musicFrame = musicProc ? await readExact(musicProc.stdout, FRAME) : null;
  const musicPcm = musicFrame && musicFrame.pcm ? musicFrame.pcm : Buffer.alloc(FRAME);
  if (!musicFrame || musicFrame.ended) {
    closeProc(musicProc);
    musicProc = null;
  }
  let voice = null;
  if (chimeOn && chimeProc) {
    const chimeFrame = await readExact(chimeProc.stdout, FRAME);
    if (!chimeFrame || chimeFrame.ended) {
      if (chimeFrame && chimeFrame.pcm) voice = chimeFrame.pcm;
      closeProc(chimeProc);
      chimeProc = null;
      chimeOn = false;
      now.chime = false;
      reportHeld = false;
    } else {
      voice = chimeFrame.pcm;
    }
  } else if (playing && reportProc) {
    const reportFrame = await readExact(reportProc.stdout, FRAME);
    if (!reportFrame || reportFrame.ended) {
      if (reportFrame && reportFrame.pcm) voice = reportFrame.pcm;
      closeProc(reportProc);
      reportProc = null;
      finishReport();
    } else {
      voice = reportFrame.pcm;
    }
  }
  await writePcm(mix(musicPcm, voice));
  paced += 1;
  const wait = (paced * 100) - (Date.now() - paceAt);
  if (wait > 4) await sleep(wait);
}

async function loop() {
  while (!stopped) {
    try {
      await step();
    } catch (err) {
      console.log('step ' + err.message);
      await sleep(200);
    }
  }
}

function shutdown() {
  stopped = true;
  clearTimeout(gapTimer);
  closeProc(musicProc);
  closeProc(reportProc);
  closeProc(chimeProc);
  if (encoder) {
    try { encoder.stdin.end(); } catch (err) {}
    try { encoder.kill('SIGKILL'); } catch (err) {}
  }
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD' });
    res.end('Method not allowed\n');
    return;
  }
  if (url.pathname === '/health') {
    const body = JSON.stringify({ ok: true, encoder: !!(encoder && encoder.exitCode == null) });
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
    res.end(body);
    return;
  }
  if (url.pathname === '/radio/now.json' || url.pathname === '/now.json') {
    const body = JSON.stringify({
      ok: true,
      music: now.music,
      description: now.description,
      report: now.chime ? 'Time' : now.report,
      chime: now.chime,
      listeners: clients.size
    });
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
    res.socket && res.socket.setNoDelay(true);
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

server.listen(PORT, HOST, () => {
  console.log('station listening on ' + HOST + ':' + PORT);
  startEncoder();
  scan();
  setInterval(scan, 5000);
  armGap();
  loop();
});
