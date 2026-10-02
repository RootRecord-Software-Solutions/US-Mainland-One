#!/usr/bin/env node
'use strict';

const http = require('http');
const fs = require('fs');
const url = require('url');

const HOST = process.env.GLOBE_BIND || '0.0.0.0';
const PORT = Number(process.env.GLOBE_PORT || 8787);
const FEED = process.env.GLOBE_FEED || '/home/ubuntu/network-globe/network-globe/data/hawaii.ndjson';
const MAX_READ = Number(process.env.GLOBE_MAX_READ || 2 * 1024 * 1024);

function send(res, code, body, type) {
  res.writeHead(code, {
    'Content-Type': type || 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(body);
}

function feed(req, res, from) {
  fs.stat(FEED, (err, st) => {
    if (err) return send(res, 404, 'feed not ready\n');
    const size = st.size;
    let offset = Number.isFinite(from) ? Math.max(0, from) : 0;
    if (offset > size) offset = 0;
    const length = Math.min(MAX_READ, size - offset);
    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Access-Control-Allow-Origin': '*',
      'X-Feed-Size': String(size),
      'X-Next-Offset': String(offset + length)
    });
    if (!length) return res.end();
    const stream = fs.createReadStream(FEED, {start: offset, end: offset + length - 1});
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  });
}

http.createServer((req, res) => {
  const u = url.parse(req.url, true);
  if (u.pathname === '/health')
    return send(res, 200, JSON.stringify({ok:true, feed:FEED}) + '\n', 'application/json; charset=utf-8');
  if (u.pathname === '/hawaii.ndjson')
    return feed(req, res, Number(u.query.from || 0));
  send(res, 404, 'not found\n');
}).listen(PORT, HOST, () => {
  console.log('Network Globe NDJSON feed listening on ' + PORT);
});
