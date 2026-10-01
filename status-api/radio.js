'use strict';

// Static library for the public radio stream.
// Hawaii replaces each <report>_current.ogg. This process only reads the directory.

const fs = require('fs');
const path = require('path');

const AUDIO = process.env.RADIO_DIR || path.join(__dirname, '..', 'communications', 'rootrecord-radio', 'audio');
const REPORTS = process.env.RADIO_REPORTS_DIR || path.join(AUDIO, 'reports');
const MUSIC_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,180}\.mp3$/;
const REPORT_NAME = /^[a-z0-9]+(?:_[a-z0-9]+)*_current\.ogg$/;

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
      : row.name.replace(/\.mp3$/i, '');
    const description = typeof meta.description === 'string' ? meta.description.trim() : '';
    return { name: row.name, bytes: row.bytes, mtime: row.mtime, title, description };
  });
  const reports = list(REPORTS, (name) => REPORT_NAME.test(name)).map((row) => ({
    id: row.name.slice(0, -'_current.ogg'.length),
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

function serveFile(req, res, filePath, type, cache) {
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
    res.writeHead(206, Object.assign({
      'Content-Range': 'bytes ' + start + '-' + end + '/' + size,
      'Content-Length': (end - start) + 1
    }, base));
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
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
  if (url.pathname !== '/radio/catalog.json' && !url.pathname.startsWith('/radio/music/') && !url.pathname.startsWith('/radio/reports/')) {
    return false;
  }
  if (url.pathname === '/radio/catalog.json') {
    sendJson(res, 200, catalog());
    return true;
  }
  const kind = url.pathname.startsWith('/radio/music/') ? 'music' : 'reports';
  const raw = url.pathname.slice(('/radio/' + kind + '/').length);
  let name = raw;
  try {
    name = decodeURIComponent(raw);
  } catch {
    name = raw;
  }
  const test = kind === 'music' ? MUSIC_NAME : REPORT_NAME;
  const filePath = safeFile(kind === 'music' ? path.join(AUDIO, 'music') : REPORTS, name, test);
  if (!filePath) {
    res.writeHead(404, cors({ 'Content-Type': 'text/plain; charset=utf-8' }));
    res.end('Not found\n');
    return true;
  }
  const type = kind === 'music' ? 'audio/mpeg' : 'audio/ogg';
  const cache = kind === 'music' ? 'public, max-age=86400' : 'no-store';
  serveFile(req, res, filePath, type, cache);
  return true;
}

module.exports = { handle, catalog, AUDIO, REPORTS };
