'use strict';

// One station. One encoder. Listeners join this live mix.
// Music stays open underneath the half-hour cycle.
// Pacific/Honolulu HH:59:59 and HH:29:59 duck the bed, then the chime,
// then every current report, longest first, then full music again.
// A boundary cuts a cycle that is still running. A new file waits
// for the next cycle. Code activation waits until the cycle is idle,
// then exits 75.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function runtimeRoot() {
  if (process.env.RADIO_ROOT) return path.resolve(process.env.RADIO_ROOT);
  const cwd = process.cwd();
  if (fs.existsSync(path.join(cwd, 'audio'))) return cwd;
  const beside = path.resolve(__dirname, '..', 'rootrecord-radio');
  if (fs.existsSync(path.join(beside, 'audio'))) return beside;
  return cwd;
}

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 8092);
const RUNTIME = runtimeRoot();
const AUDIO = process.env.RADIO_DIR || path.join(RUNTIME, 'audio');
const REPORTS = process.env.RADIO_REPORTS_DIR || path.join(AUDIO, 'reports');
const HEARTBEAT = process.env.RADIO_HEARTBEAT || path.join(RUNTIME, 'state', 'heartbeat');
const DEPLOY_FILE = process.env.RADIO_DEPLOY_PENDING || path.join(RUNTIME, 'deploy-pending');
const RELEASE = process.env.RADIO_RELEASE || '';
process.env.RADIO_DIR = AUDIO;
process.env.RADIO_REPORTS_DIR = REPORTS;

const radio = require(process.env.RADIO_LIB || path.join(__dirname, 'radio'));

const RATE = 44100;
const FRAME = RATE * 2 * 2 / 10;
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
  chimeSlot: '',
  chimeTarget: null,
  chimeMissing: '',
  deferredSha: ''
};

const stageQueue = [];
let stageProc = null;
let stageItem = null;

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
let cycleQueue = [];
let restoreAfterFrame = false;
const durationSec = new Map();
let paced = 0;
let paceAt = Date.now();
let lastBeat = 0;

function log(event, fields) {
  const parts = ['event=' + event, 'at=' + Date.now()];
  const data = fields || {};
  for (const key of Object.keys(data)) {
    parts.push(key + '=' + String(data[key]).replace(/\s+/g, '_'));
  }
  fs.writeSync(1, parts.join(' ') + '\n');
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

const DAYPARTS = ['morning_report', 'midday_report', 'late_report'];

function currentDaypart(date) {
  const clock = hawaiiClock(date || stationNow());
  const minute = clock.hour * 60 + clock.minute;
  if (minute >= 9 * 60 && minute < 12 * 60) return 'morning_report';
  if (minute >= 12 * 60 && minute < 21 * 60) return 'midday_report';
  return 'late_report';
}

function daypartFile(id, ext) {
  return inside(REPORTS, id + '_current' + ext);
}

function daypartPresent(id) {
  for (const ext of ['.opus', '.ogg']) {
    const full = daypartFile(id, ext);
    if (full && fs.existsSync(full)) return true;
  }
  return false;
}

function dropOtherDayparts(date) {
  const keep = currentDaypart(date);
  if (!daypartPresent(keep)) return;
  const removed = [];
  for (const id of DAYPARTS) {
    if (id === keep) continue;
    for (const ext of ['.opus', '.ogg']) {
      const full = daypartFile(id, ext);
      if (!full) continue;
      try {
        fs.unlinkSync(full);
        removed.push(id + '_current' + ext);
      } catch (err) {
        if (!err || err.code !== 'ENOENT') log('daypart_clear_error', { id: id, ext: ext });
      }
    }
  }
  if (removed.length) log('daypart_clear', { keep: keep, removed: removed.join(',') });
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

function missingTool(proc, bin) {
  proc.on('error', (err) => {
    if (err && err.code === 'ENOENT') {
      log('dependency_missing', { bin: bin });
      process.exit(127);
    }
  });
}

function openDecode(file) {
  const proc = spawn('ffmpeg', [
    '-hide_banner', '-loglevel', 'error',
    '-i', file,
    '-f', 's16le', '-ar', String(RATE), '-ac', '2',
    '-flush_packets', '1',
    'pipe:1'
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  missingTool(proc, 'ffmpeg');
  return proc;
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
  missingTool(encoder, 'ffmpeg');
  log('encoder_up', { pid: encoder.pid });
  encoder.stdout.on('data', (chunk) => {
    preroll.push(chunk);
    prerollBytes += chunk.length;
    while (prerollBytes > 131072 && preroll.length > 1) prerollBytes -= preroll.shift().length;
    for (const res of clients) {
      if (res.writableEnded || res.destroyed) {
        clients.delete(res);
        continue;
      }
      // A stuck socket used to skip frames. That punched holes in the MP3
      // and the browser heard a cut. Close that one listener instead.
      if (res.writableLength > 262144) {
        clients.delete(res);
        res.destroy();
        continue;
      }
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

function ducked() {
  return station.phase !== 'NORMAL';
}

function mix(music, voice) {
  const out = Buffer.alloc(FRAME);
  const gain = ducked() ? DUCK : 1;
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

function reportPath(name) {
  return inside(REPORTS, name);
}

function noteDuration(file, ident) {
  if (durationSec.has(ident)) return;
  durationSec.set(ident, null);
  const proc = spawn('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'csv=p=0',
    file
  ], { stdio: ['ignore', 'pipe', 'ignore'] });
  let text = '';
  proc.stdout.on('data', (chunk) => { text += chunk; });
  proc.on('error', () => { durationSec.set(ident, 0); });
  proc.on('exit', () => {
    const n = Number(String(text).trim());
    durationSec.set(ident, Number.isFinite(n) && n > 0 ? n : 0);
  });
}

function fileIdent(file) {
  const st = fs.statSync(file);
  return st.dev + ':' + st.ino + ':' + st.size + ':' + Math.floor(st.mtimeMs);
}

function beginReport(item) {
  const file = reportPath(item.file);
  if (!file || !fs.existsSync(file)) {
    log('report_skip', { id: item.id, detail: 'missing' });
    return false;
  }
  let ident = '';
  try {
    ident = fileIdent(file);
  } catch (err) {
    log('report_skip', { id: item.id, detail: 'stat' });
    return false;
  }
  if (item.ident && ident !== item.ident) {
    log('report_skip', { id: item.id, detail: 'replaced' });
    return false;
  }
  if (reportProc) reportProc.stop();
  station.report = 'ACTIVE';
  station.playing = { id: item.id, file: item.file, ident: ident, at: Date.now() };
  now.report = titleOf(item.id);
  reportProc = new Decoder(file);
  station.playing.pid = reportProc.proc.pid;
  log('report_start', { id: item.id, ident: ident, pid: station.playing.pid });
  return true;
}

function startNextReport() {
  while (cycleQueue.length) {
    if (beginReport(cycleQueue.shift())) return true;
  }
  return false;
}

function finishReport() {
  if (!station.playing) return;
  const done = station.playing;
  const elapsed = ((Date.now() - (done.at || Date.now())) / 1000).toFixed(1);
  station.playing = null;
  station.report = 'NONE';
  now.report = '';
  if (reportProc) reportProc.stop();
  reportProc = null;
  log('report_end', { id: done.id, ident: done.ident, pid: done.pid, seconds: elapsed });
  if (station.phase === 'REPORTS' && stageQueue.length) {
    const row = stageQueue.shift();
    if (beginStaged(row, 'REPORTS')) return;
  }
  if (station.phase !== 'REPORTS') return;
  if (!startNextReport()) restoreAfterFrame = true;
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
  noteDuration(file, ident);
  return { id: row.id, file: row.file, ident: ident, bytes: Number(row.bytes) || 0 };
}

function applyCatalog(data) {
  tracks = (data.music || []).filter((row) => row && row.name);
  const next = [];
  const live = {};
  for (const row of data.reports || []) {
    if (!row || !row.id || !row.file) continue;
    const item = enrich(row);
    if (!item) continue;
    next.push(item);
    live[item.ident] = true;
  }
  reports = next;
  for (const ident of durationSec.keys()) {
    if (!live[ident]) durationSec.delete(ident);
  }
}

function snapshotReports() {
  const keep = currentDaypart(stationNow());
  const rows = reports.filter((row) => DAYPARTS.indexOf(row.id) < 0 || row.id === keep);
  const known = rows.length > 0 && rows.every((row) => {
    const duration = durationSec.get(row.ident);
    return typeof duration === 'number' && duration > 0;
  });
  rows.sort((a, b) => {
    if (known) {
      const diff = durationSec.get(b.ident) - durationSec.get(a.ident);
      if (diff) return diff;
    }
    if (b.bytes !== a.bytes) return b.bytes - a.bytes;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });
  return rows;
}

function boundaryTarget(clock) {
  if (clock.second !== 59) return null;
  if (clock.minute !== 29 && clock.minute !== 59) return null;
  if (clock.minute === 29) {
    return {
      hour: clock.hour,
      minute: 30,
      slot: clock.date + 'T' + pad(clock.hour) + ':30'
    };
  }
  let year = clock.year;
  let month = clock.month;
  let day = clock.day;
  const hour = (clock.hour + 1) % 24;
  if (hour === 0) {
    const next = new Date(Date.UTC(year, month - 1, day) + 86400000);
    year = next.getUTCFullYear();
    month = next.getUTCMonth() + 1;
    day = next.getUTCDate();
  }
  const date = year + '-' + pad(month) + '-' + pad(day);
  return { hour: hour, minute: 0, slot: date + 'T' + pad(hour) + ':00' };
}

function stopVoice() {
  if (reportProc) reportProc.stop();
  reportProc = null;
  if (chimeProc) chimeProc.stop();
  chimeProc = null;
  if (stageProc) stageProc.stop();
  stageProc = null;
  stageItem = null;
  station.playing = null;
  station.report = 'NONE';
  now.report = '';
}

function takeStage() {
  const dir = path.join(RUNTIME, 'state', 'stage');
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch (err) {
    return;
  }
  names.sort();
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const full = path.join(dir, name);
    try {
      const row = JSON.parse(fs.readFileSync(full, 'utf8'));
      fs.unlinkSync(full);
      if (!row || !row.id) continue;
      const hour = Number(row.hour);
      const minute = Number(row.minute);
      if (!Number.isInteger(hour) || (minute !== 0 && minute !== 30) || hour < 0 || hour > 23) continue;
      stageQueue.push({ id: String(row.id), hour: hour, minute: minute });
      log('stage_queued', { id: row.id, slot: pad(hour) + ':' + pad(minute) });
    } catch (err) {
      log('stage_skip', { file: name });
    }
  }
}

function cueFile(id, minute) {
  const name = id + (minute === 30 ? '-half' : '-hour') + '.opus';
  return inside(path.join(AUDIO, 'cues'), name);
}

function noticeFile() {
  return inside(path.join(AUDIO, 'cues'), 'notify.opus');
}

function beginStaged(row, resume) {
  const line = cueFile(row.id, row.minute);
  const notice = noticeFile();
  const hasNotice = notice && fs.existsSync(notice);
  const hasLine = line && fs.existsSync(line);
  const first = hasNotice ? notice : (hasLine ? line : '');
  if (!first) {
    log('stage_missing', { id: row.id, slot: pad(row.hour) + ':' + pad(row.minute) });
    return false;
  }
  stageItem = {
    id: row.id,
    hour: row.hour,
    minute: row.minute,
    resume: resume || 'NORMAL',
    line: line,
    part: hasNotice ? 'notice' : 'line'
  };
  station.phase = 'STAGED';
  station.playing = { id: row.id, file: path.basename(first), at: Date.now() };
  now.report = titleOf(row.id) + ' staged';
  stageProc = new Decoder(first);
  log('stage_start', { id: row.id, part: stageItem.part, slot: pad(row.hour) + ':' + pad(row.minute) });
  return true;
}

function finishStaged() {
  const done = stageItem;
  if (stageProc) stageProc.stop();
  stageProc = null;
  stageItem = null;
  station.playing = null;
  now.report = '';
  log('stage_end', { id: done ? done.id : '' });
  if (done && done.resume === 'REPORTS') {
    station.phase = 'REPORTS';
    if (!startNextReport()) restoreAfterFrame = true;
    return;
  }
  station.phase = 'NORMAL';
  station.report = 'NONE';
}

function advanceStage() {
  if (!stageItem) return;
  if (stageItem.part === 'notice' && stageItem.line && fs.existsSync(stageItem.line)) {
    stageItem.part = 'line';
    station.playing = { id: stageItem.id, file: path.basename(stageItem.line), at: Date.now() };
    now.report = titleOf(stageItem.id) + ' staged';
    stageProc = new Decoder(stageItem.line);
    log('stage_line', { id: stageItem.id, slot: pad(stageItem.hour) + ':' + pad(stageItem.minute) });
    return;
  }
  finishStaged();
}

function pumpStage() {
  if (stageItem || !stageQueue.length) return;
  if (station.phase !== 'NORMAL' || station.report === 'ACTIVE') return;
  const row = stageQueue.shift();
  if (!beginStaged(row, 'NORMAL') && stageQueue.length) pumpStage();
}

function maybeBoundary() {
  const target = boundaryTarget(hawaiiClock(stationNow()));
  if (!target || target.slot === station.chimeSlot) return;
  const cutting = station.phase !== 'NORMAL' || station.report === 'ACTIVE';
  if (cutting && station.playing) log('report_cut', { id: station.playing.id, slot: target.slot });
  stopVoice();
  restoreAfterFrame = false;
  cycleQueue = snapshotReports();
  station.chimeSlot = target.slot;
  station.chimeTarget = target;
  station.phase = 'DUCK';
  log('cycle_duck', { slot: target.slot, reports: cycleQueue.length, cut: cutting ? 1 : 0 });
}

function beginReportPass() {
  station.phase = 'REPORTS';
  if (!startNextReport()) restoreAfterFrame = true;
}

function maybeStartChime() {
  if (station.phase !== 'DUCK' || !station.chimeTarget) return;
  const clock = hawaiiClock(stationNow());
  if (clock.hour !== station.chimeTarget.hour || clock.minute !== station.chimeTarget.minute) return;
  const slot = station.chimeTarget.slot;
  const file = inside(path.join(AUDIO, 'chimes'), 'hour-' + pad(station.chimeTarget.hour) + '-' + pad(station.chimeTarget.minute) + '.opus');
  if (!file || !fs.existsSync(file)) {
    if (station.chimeMissing !== slot) {
      station.chimeMissing = slot;
      log('chime_missing', { slot: slot });
    }
    beginReportPass();
    return;
  }
  station.phase = 'CHIME';
  chimeProc = new Decoder(file);
  log('chime_start', { slot: slot, pid: chimeProc.proc.pid });
}

function scan() {
  try {
    const clock = stationNow();
    dropOtherDayparts(clock);
    applyCatalog(radio.catalog(clock));
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
  now.music = row.title || row.name.replace(/\.opus$/i, '');
  now.description = row.description || '';
  musicProc = new Decoder(file);
  log('music_start', { pid: musicProc.proc.pid, title: now.music });
}

function endChime() {
  const slot = station.chimeSlot;
  if (chimeProc) chimeProc.stop();
  chimeProc = null;
  log('chime_end', { slot: slot });
  if (stageQueue.length) {
    const row = stageQueue.shift();
    if (beginStaged(row, 'REPORTS')) return;
  }
  beginReportPass();
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
  return station.phase !== 'NORMAL';
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
      log('deploy_deferred', { sha: sha, reason: station.phase === 'NORMAL' ? 'report' : station.phase.toLowerCase() });
    }
    return;
  }
  log('deploy_activate', { sha: sha });
  shutdown(DEPLOY_EXIT, 'deploy_activate');
}

function releaseDuck() {
  if (!restoreAfterFrame) return;
  restoreAfterFrame = false;
  if (station.phase === 'REPORTS' && station.report === 'NONE') {
    station.phase = 'NORMAL';
    log('cycle_restore', { slot: station.chimeSlot || '' });
  }
}

async function step() {
  maybeBoundary();
  maybeStartChime();
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
  takeStage();
  pumpStage();
  if (station.phase === 'STAGED' && stageProc) {
    const frame = stageProc.take();
    if (frame && frame.pcm) voice = frame.pcm;
    if (frame && frame.ended) {
      stageProc.stop();
      stageProc = null;
      advanceStage();
    }
  } else if (station.phase === 'CHIME' && chimeProc) {
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
  releaseDuck();
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
    duck: ducked() ? DUCK : 1,
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
  loop();
});
