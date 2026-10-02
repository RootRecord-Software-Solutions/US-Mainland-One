const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const port = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'network-globe', uptime: process.uptime() });
});

app.get('/api/state', (_req, res) => {
  res.json({
    origin: { label: 'collector' },
    stats: { activeFlows: 0, endpoints: 0, packetRate: 0, bytesPerSec: 0, collector: 'network-globe' },
    aws: { ok: false, reason: 'no AWS telemetry' },
    arcs: [],
    points: []
  });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(port, () => console.log(`Network Globe listening on ${port}`));
