# Mainland system monitor

Whole-host, JSON-first system monitoring package.

## Metrics

The current JSON includes:

- CPU count, load averages, and per-CPU kernel time counters
- RAM: total, available, free, buffers, cache
- Swap: total/free
- Storage: every detected non-temporary filesystem, capacity, used/free bytes and percentage
- Temperatures from Linux thermal zones and hwmon sensors when the host exposes them
- Network interface RX/TX bytes, packets, errors and drops
- Process count
- Hostname, platform, kernel, architecture and uptime

## Rolling averages

Every numeric metric gets rolling averages for:

`1s`, `1min`, `5m`, `15m`, `30m`, `1h`, `3h`, `6h`, `12h`, `24h`, `3d`, `7d`, `1m`, `1y`.

`1m` means one month. `1min` means one minute.

Each window reports `sample_count`, `window_seconds`, and its available averaged numeric values.

## Storage engine

The public/current data is only:

`/home/ubuntu/system-monitor/system-current.json`

A local SQLite database is used internally at:

`/home/ubuntu/system-monitor/system-monitor.sqlite3`

It stores the scalar measurements needed for rolling averages and automatically purges samples older than one year.

No CSV, YAML, archive snapshots, renamed history files, or other persistent monitoring formats are generated.

Some hardware metrics are inherently host-dependent. Temperature sensors, for example, only appear when Linux exposes them through thermal zones or hwmon.

Run with:

`bash /home/ubuntu/system-monitor/sys-sample.sh`
