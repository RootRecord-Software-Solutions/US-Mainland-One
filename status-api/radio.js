'use strict';

// Static library for the public radio stream.
// Hawaii replaces each <report>_current.opus. This process only reads the directory.

const fs = require('fs');
const path = require('path');

const RUNTIME = process.env.RADIO_ROOT || process.cwd();
const AUDIO = process.env.RADIO_DIR || path.join(RUNTIME, 'audio');
const REPORTS = process.env.RADIO_REPORTS_DIR || path.join(AUDIO, 'reports');
const PLAY_LOG = process.env.RADIO_PLAY_LOG || path.join(path.dirname(AUDIO), 'plays.log');
const MUSIC_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,180}\.opus$/;
const REPORT_NAME = /^[a-z0-9]+(?:_[a-z0-9]+)*_current\.opus$/;
const CHIME_NAME = /^hour-(?:[01]\d|2[0-3])-(?:00|30)\.opus$/;

function cors(extra) {
  return Object.assign({
    'Access-Control-Allow-Origin': '*',
    'X-Content-Type-Options': 'nosniff'
  }, extra || {});
}

function list(dir, test) {
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    if (!test(name)) continue;
    const full = path.resolve(dir, name);
    if (!full.startsWith(path.resolve(dir) + path.sep)) continue;
    let st;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    out.push({ name, bytes: st.size, mtime: Math.floor(st.mtimeMs) });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

function loadLibrary() {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(AUDIO, 'library.json'), 'utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function catalog() {
  const lib = loadLibrary();
  const music = list(path.join(AUDIO, 'music'), (name) => MUSIC_NAME.test(name)).map((row) => {
    const meta = lib[row.name] || {};
    const title = typeof meta.title === 'string' && meta.title.trim()
      ? meta.title.trim()
      : row.name.replace(/\.opus$/i, '');
    const description = typeof meta.description === 'string' ? meta.description.trim() : '';
    return { name: row.name, bytes: row.bytes, mtime: row.mtime, title, description };
  });
  // Opus only. A leftover *_current.ogg for the same id is not a second copy.
  const reports = list(REPORTS, (name) => REPORT_NAME.test(name)).map((row) => ({
    id: row.name.slice(0, -'_current.opus'.length),
    file: row.name,
    bytes: row.bytes,
    mtime: row.mtime
  }));
  return { ok: true, music, reports };
}

function sendJson(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, cors({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body)
  }));
  res.end(body);
}

function safeFile(dir, name, pattern) {
  if (!pattern.test(name)) return null;
  const root = path.resolve(dir);
  const full = path.resolve(dir, name);
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}

function recordPlay(kind, name, bytes) {
  const line = new Date().toISOString() + '\t' + kind + '\t' + name + '\t' + String(bytes) + '\n';
  fs.mkdir(path.dirname(PLAY_LOG), { recursive: true }, () => {
    fs.appendFile(PLAY_LOG, line, () => {});
  });
}

function serveFile(req, res, filePath, type, cache, play) {
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, cors({ 'Content-Type': 'text/plain; charset=utf-8' }));
      res.end('Not found\n');
      return;
    }
    const size = st.size;
    const base = cors({
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
      'Cache-Control': cache
    });
    const range = req.headers.range;
    if (!range) {
      res.writeHead(200, Object.assign({ 'Content-Length': size }, base));
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      if (play) recordPlay(play.kind, play.name, size);
      fs.createReadStream(filePath).on('error', () => res.destroy()).pipe(res);
      return;
    }
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (match[1] === '' && match[2] === '')) {
      res.writeHead(416, cors({ 'Content-Range': 'bytes */' + size }));
      res.end();
      return;
    }
    let start = match[1] === '' ? null : Number(match[1]);
    let end = match[2] === '' ? null : Number(match[2]);
    if (start === null) {
      const take = end;
      if (!take) {
        res.writeHead(416, cors({ 'Content-Range': 'bytes */' + size }));
        res.end();
        return;
      }
      start = Math.max(0, size - take);
      end = size - 1;
    } else if (end === null || end >= size) {
      end = size - 1;
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= size || start > end) {
      res.writeHead(416, cors({ 'Content-Range': 'bytes */' + size }));
      res.end();
      return;
    }
    const span = (end - start) + 1;
    res.writeHead(206, Object.assign({
      'Content-Range': 'bytes ' + start + '-' + end + '/' + size,
      'Content-Length': span
    }, base));
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    // Browsers probe with a 1–2 byte range, then start the file at byte 0.
    if (play && start === 0 && span > 1024) recordPlay(play.kind, play.name, span);
    fs.createReadStream(filePath, { start, end }).on('error', () => res.destroy()).pipe(res);
  });
}

function handle(req, res, url) {
  try {
    return route(req, res, url);
  } catch {
    if (!res.headersSent) {
      res.writeHead(404, cors({ 'Content-Type': 'text/plain; charset=utf-8' }));
      res.end('Not found\n');
    }
    return true;
  }
}

function route(req, res, url) {
  const isMusic = url.pathname.startsWith('/radio/music/');
  const isReports = url.pathname.startsWith('/radio/reports/');
  const isChimes = url.pathname.startsWith('/radio/chimes/');
  if (url.pathname !== '/radio/catalog.json' && !isMusic && !isReports && !isChimes) {
    return false;
  }
  if (url.pathname === '/radio/catalog.json') {
    sendJson(res, 200, catalog());
    return true;
  }
  const kind = isMusic ? 'music' : (isChimes ? 'chimes' : 'reports');
  const raw = url.pathname.slice(('/radio/' + kind + '/').length);
  let name = raw;
  try {
    name = decodeURIComponent(raw);
  } catch {
    name = raw;
  }
  const test = kind === 'music' ? MUSIC_NAME : (kind === 'chimes' ? CHIME_NAME : REPORT_NAME);
  const dir = kind === 'music' ? path.join(AUDIO, 'music') : (kind === 'chimes' ? path.join(AUDIO, 'chimes') : REPORTS);
  const filePath = safeFile(dir, name, test);
  if (!filePath) {
    res.writeHead(404, cors({ 'Content-Type': 'text/plain; charset=utf-8' }));
    res.end('Not found\n');
    return true;
  }
  const type = 'audio/ogg';
  const cache = kind === 'reports' ? 'no-store' : 'public, max-age=86400';
  serveFile(req, res, filePath, type, cache, { kind, name });
  return true;
}

module.exports = { handle, catalog, AUDIO, REPORTS };
