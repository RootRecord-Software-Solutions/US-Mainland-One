'use strict';

// Fixture tests for the radio engine. Each case starts its own process.

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const API = __dirname;
const STREAM = path.join(API, 'stream.js');
const RADIO = path.join(API, 'radio.js');
const PUSH = path.resolve(API, '..', '..', '..', '1 - Servers', '1 - RootRecord-Pacific-Solar-Server', 'Media', 'Voice', 'scripts', 'radio_push.py');
const RUN = path.join(API, 'radio-run.sh');

function synth(file, seconds, freq, codec) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
    'sine=frequency=' + freq + ':sample_rate=44100:duration=' + seconds];
  if (codec === 'mp3') args.push('-c:a', 'libmp3lame', '-b:a', '64k');
  else if (codec === 'ogg') args.push('-c:a', 'libvorbis', '-q:a', '2');
  else args.push('-c:a', 'pcm_s16le');
  args.push(file);
  const made = spawnSync('ffmpeg', args, { stdio: 'ignore' });
  if (made.status !== 0) throw new Error('ffmpeg failed for ' + file);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getJson(port, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: pathname, timeout: 2000 }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (err) { reject(err); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout ' + pathname)); });
  });
}

class Station {
  constructor(name) {
    this.name = name;
    this.root = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-radio-'));
    this.audio = path.join(this.root, 'audio');
    this.reports = path.join(this.audio, 'reports');
    this.clock = path.join(this.root, 'clock');
    this.heartbeat = path.join(this.root, 'state', 'heartbeat');
    this.pending = path.join(this.root, 'deploy-pending');
    this.port = 19000 + Math.floor(Math.random() * 2000);
    this.lines = [];
    this.child = null;
    fs.mkdirSync(this.reports, { recursive: true });
    fs.mkdirSync(path.join(this.audio, 'music'), { recursive: true });
    fs.mkdirSync(path.join(this.audio, 'chimes'), { recursive: true });
    fs.writeFileSync(this.clock, '2026-10-01T14:15:10-10:00\n');
  }

  env(extra) {
    return Object.assign({}, process.env, {
      HOST: '127.0.0.1',
      PORT: String(this.port),
      RADIO_DIR: this.audio,
      RADIO_REPORTS_DIR: this.reports,
      RADIO_LIB: RADIO,
      RADIO_CLOCK_FILE: this.clock,
      RADIO_HEARTBEAT: this.heartbeat,
      RADIO_DEPLOY_PENDING: this.pending,
      RADIO_RELEASE: 'test',
      RADIO_OPEN_MS: '400',
      RADIO_GAP_MS: '60000',
      RADIO_SCAN_MS: '150'
    }, extra || {});
  }

  start(extra) {
    this.child = spawn(process.execPath, [STREAM], {
      env: this.env(extra),
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const take = (buf) => {
      for (const line of buf.toString('utf8').split('\n')) {
        if (line.trim()) this.lines.push(line.trim());
      }
    };
    this.child.stdout.on('data', take);
    this.child.stderr.on('data', take);
  }

  setClock(iso) {
    fs.writeFileSync(this.clock, iso + '\n');
  }

  events(name) {
    return this.lines.filter((line) => line.includes('event=' + name + ' ') || line.endsWith('event=' + name));
  }

  field(line, key) {
    const match = new RegExp('(?:^| )' + key + '=([^ ]*)').exec(line);
    return match ? match[1] : '';
  }

  async until(fn, ms) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (fn()) return;
      await sleep(50);
    }
    throw new Error(this.name + ' timed out\n' + this.lines.join('\n'));
  }

  async stop() {
    if (!this.child || this.child.killed) return;
    const pid = this.child.pid;
    try { process.kill(-pid, 'SIGTERM'); } catch (err) {}
    await sleep(200);
    try { process.kill(-pid, 'SIGKILL'); } catch (err) {}
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

async function testMusicContinuity() {
  const station = new Station('A');
  synth(path.join(station.audio, 'music', 'Bed.mp3'), 30, 220, 'mp3');
  synth(path.join(station.reports, 'energy_report_current.ogg'), 1.6, 440, 'ogg');
  synth(path.join(station.audio, 'chimes', 'hour-14-00.wav'), 0.8, 880, 'wav');
  station.start();
  await station.until(() => station.events('report_start').length === 1, 8000);
  const music = station.events('music_start');
  assert(music.length === 1, 'music restarted before the report');
  const pid = station.field(music[0], 'pid');
  station.setClock('2026-10-01T14:00:01-10:00');
  await station.until(() => station.events('chime_start').length === 1, 5000);
  await station.until(() => station.events('report_resumed').length === 1, 5000);
  const body = await getJson(station.port, '/now.json');
  assert(String(body.musicPid) === pid, 'music pid changed across the chime');
  assert(station.events('music_start').length === 1, 'music decoder was reopened');
  await station.stop();
  console.log('pass A music continuity');
}

async function testReportEof() {
  const station = new Station('B');
  synth(path.join(station.audio, 'music', 'Bed.mp3'), 20, 220, 'mp3');
  synth(path.join(station.reports, 'energy_report_current.ogg'), 1.2, 440, 'ogg');
  station.start();
  await station.until(() => station.events('report_end').length === 1, 8000);
  const end = station.events('report_end')[0];
  assert(Number(station.field(end, 'seconds')) >= 0.8, 'report ended too soon');
  assert(station.events('station_exit').length === 0, 'station exited during the report');
  await station.stop();
  console.log('pass B report eof');
}

async function testReplacement() {
  const station = new Station('C');
  synth(path.join(station.audio, 'music', 'Bed.mp3'), 20, 220, 'mp3');
  const live = path.join(station.reports, 'energy_report_current.ogg');
  synth(live, 8.0, 440, 'ogg');
  station.start();
  await station.until(() => station.events('report_start').length === 1, 8000);
  const started = station.events('report_start')[0];
  const ident = station.field(started, 'ident');
  const pid = Number(station.field(started, 'pid'));
  const next = path.join(station.reports, 'energy_next.ogg');
  synth(next, 0.6, 660, 'ogg');
  fs.renameSync(next, live);
  await station.until(() => station.events('report_replacement').length === 1, 4000);
  assert(fs.existsSync('/proc/' + pid), 'old report decoder died when the file was replaced');
  await station.until(() => station.events('report_end').length === 1, 15000);
  const ended = station.events('report_end')[0];
  assert(station.field(ended, 'ident') === ident, 'finished a different inode');
  assert(Number(station.field(ended, 'seconds')) >= 6.0, 'old report was cut to the new duration');
  await station.until(() => station.events('report_start').length === 2, 4000);
  const second = station.events('report_start')[1];
  assert(station.field(second, 'ident') !== ident, 'new version did not become eligible');
  await station.stop();
  console.log('pass C report replacement');
}

async function testChimeWithReport() {
  const station = new Station('D');
  synth(path.join(station.audio, 'music', 'Bed.mp3'), 20, 220, 'mp3');
  synth(path.join(station.reports, 'energy_report_current.ogg'), 2.4, 440, 'ogg');
  synth(path.join(station.audio, 'chimes', 'hour-14-00.wav'), 1.2, 880, 'wav');
  station.start();
  await station.until(() => station.events('report_start').length === 1, 8000);
  const startedAt = Number(station.field(station.events('report_start')[0], 'at'));
  const before = await getJson(station.port, '/now.json');
  assert(before.duck === 0.25, 'music was not ducked under the report');
  assert(before.report === 'Energy', 'now playing was not the report');
  station.setClock('2026-10-01T14:00:01-10:00');
  await station.until(() => station.events('chime_start').length === 1 && station.events('report_held').length === 1, 5000);
  const during = await getJson(station.port, '/now.json');
  assert(during.report === 'Time', 'now playing was not Time');
  assert(during.duck === 0.25, 'music was not ducked under the chime');
  assert(during.chime === true, 'chime flag was off');
  await station.until(() => station.events('report_resumed').length === 1, 5000);
  const after = await getJson(station.port, '/now.json');
  assert(after.report === 'Energy', 'held report title was not restored');
  await station.until(() => station.events('report_end').length === 1, 8000);
  const endedAt = Number(station.field(station.events('report_end')[0], 'at'));
  assert(endedAt - startedAt >= 3200, 'report frame consumption was not paused for the chime');
  await station.stop();
  console.log('pass D chime with report');
}

async function testChimeWithoutReport() {
  const station = new Station('E');
  synth(path.join(station.audio, 'music', 'Bed.mp3'), 20, 220, 'mp3');
  synth(path.join(station.reports, 'energy_report_current.ogg'), 0.8, 440, 'ogg');
  synth(path.join(station.audio, 'chimes', 'hour-14-00.wav'), 1.0, 880, 'wav');
  station.setClock('2026-10-01T14:00:01-10:00');
  station.start({ RADIO_OPEN_MS: '300' });
  await station.until(() => station.events('chime_end').length === 1, 8000);
  const start = station.events('report_start')[0];
  if (start) {
    const startAt = Number(station.field(start, 'at'));
    const chimeEnd = Number(station.field(station.events('chime_end')[0], 'at'));
    assert(startAt >= chimeEnd, 'a report began during the chime');
  }
  await station.until(() => station.events('report_start').length === 1, 5000);
  await station.stop();
  console.log('pass E chime without report');
}

async function testNewReportDuringChime() {
  const station = new Station('F');
  synth(path.join(station.audio, 'music', 'Bed.mp3'), 20, 220, 'mp3');
  synth(path.join(station.reports, 'energy_report_current.ogg'), 2.8, 440, 'ogg');
  synth(path.join(station.audio, 'chimes', 'hour-14-00.wav'), 1.0, 880, 'wav');
  station.start();
  await station.until(() => station.events('report_start').length === 1, 8000);
  station.setClock('2026-10-01T14:00:01-10:00');
  await station.until(() => station.events('report_held').length === 1, 5000);
  synth(path.join(station.reports, 'bandwidth_desk_current.ogg'), 0.7, 550, 'ogg');
  await station.until(() => station.events('report_resumed').length === 1, 5000);
  await station.until(() => station.events('report_end').some((line) => station.field(line, 'id') === 'energy_report'), 8000);
  const energyEnd = station.events('report_end').find((line) => station.field(line, 'id') === 'energy_report');
  const bandwidth = station.events('report_start').find((line) => station.field(line, 'id') === 'bandwidth_desk');
  assert(!bandwidth || Number(station.field(bandwidth, 'at')) >= Number(station.field(energyEnd, 'at')), 'new report interrupted the held report');
  await station.until(() => station.events('report_start').some((line) => station.field(line, 'id') === 'bandwidth_desk'), 5000);
  await station.stop();
  console.log('pass F new report during chime');
}

async function testChimeSlot() {
  const station = new Station('G');
  synth(path.join(station.audio, 'music', 'Bed.mp3'), 20, 220, 'mp3');
  synth(path.join(station.audio, 'chimes', 'hour-14-00.wav'), 0.4, 880, 'wav');
  station.setClock('2026-10-01T14:00:05-10:00');
  station.start({ RADIO_OPEN_MS: '60000' });
  await station.until(() => station.events('chime_start').length === 1, 5000);
  await sleep(800);
  assert(station.events('chime_start').length === 1, 'the same slot fired twice');
  station.setClock('2026-10-02T14:00:05-10:00');
  await station.until(() => station.events('chime_start').length === 2, 5000);
  const slots = station.events('chime_start').map((line) => station.field(line, 'slot'));
  assert(slots[0] !== slots[1], 'date rollover reused the slot key');
  await station.stop();
  console.log('pass G one chime per slot');
}

async function testDeployDuringReport() {
  const station = new Station('H');
  synth(path.join(station.audio, 'music', 'Bed.mp3'), 20, 220, 'mp3');
  synth(path.join(station.reports, 'energy_report_current.ogg'), 1.8, 440, 'ogg');
  station.start();
  await station.until(() => station.events('report_start').length === 1, 8000);
  fs.writeFileSync(station.pending, 'next-sha\n');
  await station.until(() => station.events('deploy_deferred').length === 1, 4000);
  assert(station.events('deploy_activate').length === 0, 'deploy activated during the report');
  const exit = await new Promise((resolve) => station.child.once('exit', resolve));
  assert(exit === 75, 'quiet boundary did not exit 75, got ' + exit);
  const deferred = Number(station.field(station.events('deploy_deferred')[0], 'at'));
  const ended = Number(station.field(station.events('report_end')[0], 'at'));
  const activated = Number(station.field(station.events('deploy_activate')[0], 'at'));
  assert(deferred < ended && ended <= activated, 'deploy did not wait for the report');
  console.log('pass H deploy during report');
}

async function testDeployDuringChime() {
  const station = new Station('I');
  synth(path.join(station.audio, 'music', 'Bed.mp3'), 20, 220, 'mp3');
  synth(path.join(station.reports, 'energy_report_current.ogg'), 2.2, 440, 'ogg');
  synth(path.join(station.audio, 'chimes', 'hour-14-00.wav'), 0.8, 880, 'wav');
  station.start();
  await station.until(() => station.events('report_start').length === 1, 8000);
  station.setClock('2026-10-01T14:00:01-10:00');
  await station.until(() => station.events('report_held').length === 1, 5000);
  fs.writeFileSync(station.pending, 'next-sha\n');
  await station.until(() => station.events('deploy_deferred').length === 1, 4000);
  await station.until(() => station.events('report_resumed').length === 1, 5000);
  assert(station.events('deploy_activate').length === 0, 'deploy activated during the chime or held report');
  const exit = await new Promise((resolve) => station.child.once('exit', resolve));
  assert(exit === 75, 'quiet boundary did not exit 75, got ' + exit);
  const activated = Number(station.field(station.events('deploy_activate')[0], 'at'));
  const ended = Number(station.field(station.events('report_end')[0], 'at'));
  const chimeEnd = Number(station.field(station.events('chime_end')[0], 'at'));
  assert(activated >= ended && ended > chimeEnd, 'deploy cut the chime or the held report');
  console.log('pass I deploy during chime');
}

async function testDaypart() {
  const station = new Station('daypart');
  synth(path.join(station.audio, 'music', 'Bed.mp3'), 15, 220, 'mp3');
  synth(path.join(station.reports, 'morning_report_current.ogg'), 0.8, 440, 'ogg');
  station.setClock('2026-10-01T08:30:00-10:00');
  station.start({ RADIO_OPEN_MS: '200' });
  await sleep(1200);
  assert(station.events('report_start').length === 0, 'morning report played before 09:00');
  station.setClock('2026-10-01T10:00:00-10:00');
  await station.until(() => station.events('report_start').some((line) => station.field(line, 'id') === 'morning_report'), 5000);
  await station.stop();
  console.log('pass daypart window');
}

function testPrune() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-radio-prune-'));
  fs.writeFileSync(path.join(root, 'energy_report_current.ogg'), 'live');
  fs.writeFileSync(path.join(root, '.gitkeep'), '');
  fs.writeFileSync(path.join(root, 'energy_report_20261001.ogg'), 'old');
  fs.writeFileSync(path.join(root, '.energy_report_current.ogg.partial'), 'young');
  const oldPartial = path.join(root, '.solar_desk_current.ogg.partial');
  fs.writeFileSync(oldPartial, 'old');
  const old = Date.now() / 1000 - 3600;
  fs.utimesSync(oldPartial, old, old);
  const script = [
    'import sys',
    'from pathlib import Path',
    'import radio_push',
    'removed = radio_push.prune_tree(Path(sys.argv[1]))',
    'print("\\n".join(sorted(removed)))',
    'print("duration", radio_push.audio_duration(Path(sys.argv[2])))'
  ].join('\n');
  const junk = path.join(root, 'not-audio.txt');
  fs.writeFileSync(junk, 'nope');
  const ran = spawnSync('python3', ['-c', script, root, junk], {
    cwd: path.dirname(PUSH),
    encoding: 'utf8'
  });
  if (ran.status !== 0) throw new Error(ran.stderr || 'prune failed');
  const names = fs.readdirSync(root).sort();
  assert(names.includes('energy_report_current.ogg'), 'live report was deleted');
  assert(names.includes('.gitkeep'), 'gitkeep was deleted');
  assert(names.includes('.energy_report_current.ogg.partial'), 'in-flight partial was deleted');
  assert(!names.includes('energy_report_20261001.ogg'), 'timestamped copy remained');
  assert(!names.includes('.solar_desk_current.ogg.partial'), 'stale partial remained');
  assert(ran.stdout.includes('duration 0'), 'invalid audio looked playable');
  console.log('pass K prune');
}

async function testWrapperAndCrash() {
  const station = new Station('M');
  synth(path.join(station.audio, 'music', 'Bed.mp3'), 15, 220, 'mp3');
  const one = path.join(station.root, 'releases', 'one');
  const two = path.join(station.root, 'releases', 'two');
  fs.mkdirSync(one, { recursive: true });
  fs.mkdirSync(two, { recursive: true });
  fs.copyFileSync(STREAM, path.join(one, 'stream.js'));
  fs.copyFileSync(RADIO, path.join(one, 'radio.js'));
  fs.copyFileSync(STREAM, path.join(two, 'stream.js'));
  fs.copyFileSync(RADIO, path.join(two, 'radio.js'));
  fs.symlinkSync(one, path.join(station.root, 'active'));
  fs.writeFileSync(station.pending, 'two\n');
  const child = spawn('bash', [RUN], {
    env: station.env({
      RADIO_ROOT: station.root,
      RADIO_DEPLOY_PENDING: station.pending,
      RADIO_OPEN_MS: '60000'
    }),
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const lines = [];
  const take = (buf) => {
    for (const line of buf.toString('utf8').split('\n')) {
      if (line.trim()) lines.push(line.trim());
    }
  };
  child.stdout.on('data', take);
  child.stderr.on('data', take);
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (lines.some((line) => line.includes('event=deploy_activated'))) break;
    await sleep(50);
  }
  assert(lines.some((line) => line.includes('event=deploy_activated sha=two')), 'wrapper did not activate the pending release\n' + lines.join('\n'));
  assert(fs.realpathSync(path.join(station.root, 'active')) === fs.realpathSync(two), 'active release did not move');
  await sleep(400);
  const health = await getJson(station.port, '/health');
  assert(health.ok === true, 'station did not stay up after activation');
  const starts = lines.filter((line) => line.includes('event=station_start'));
  const pid = Number((/pid=(\d+)/.exec(starts[starts.length - 1]) || [])[1]);
  synth(path.join(station.reports, 'energy_report_current.ogg'), 0.8, 440, 'ogg');
  await sleep(700);
  assert(fs.existsSync('/proc/' + pid), 'a new report restarted the station');
  process.kill(pid, 'SIGKILL');
  const code = await new Promise((resolve) => child.once('exit', resolve));
  assert(code === 137, 'wrapper did not surface the crash, got ' + code);
  try { process.kill(-child.pid, 'SIGKILL'); } catch (err) {}
  const again = spawn('bash', [RUN], {
    env: station.env({
      RADIO_ROOT: station.root,
      RADIO_DEPLOY_PENDING: station.pending,
      RADIO_OPEN_MS: '60000'
    }),
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const back = [];
  again.stdout.on('data', (buf) => back.push(buf.toString('utf8')));
  again.stderr.on('data', (buf) => back.push(buf.toString('utf8')));
  const healthDeadline = Date.now() + 8000;
  let recovered = false;
  while (Date.now() < healthDeadline) {
    try {
      const body = await getJson(station.port, '/health');
      if (body.ok) { recovered = true; break; }
    } catch (err) {}
    await sleep(100);
  }
  try { process.kill(-again.pid, 'SIGKILL'); } catch (err) {}
  assert(recovered, 'restart after kill -9 did not bring the station back\n' + back.join(''));
  console.log('pass M crash recovery and L deploy switch');
}

async function main() {
  const tests = [
    testMusicContinuity,
    testReportEof,
    testReplacement,
    testChimeWithReport,
    testChimeWithoutReport,
    testNewReportDuringChime,
    testChimeSlot,
    testDeployDuringReport,
    testDeployDuringChime,
    testDaypart,
    testWrapperAndCrash
  ];
  testPrune();
  for (const test of tests) {
    await test();
  }
  console.log('all radio engine tests passed');
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
