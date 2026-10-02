#!/usr/bin/env bash
set -euo pipefail

OUT="/home/ubuntu/system-monitor/system-current.json"
DB="/home/ubuntu/system-monitor/system-monitor.sqlite3"
mkdir -p "$(dirname "$OUT")"

python3 - "$OUT" "$DB" <<'PY'
import json, os, platform, shutil, sqlite3, subprocess, sys, time
from pathlib import Path

OUT, DB = map(Path, sys.argv[1:])

WINDOWS = {
    "1s": 1, "1min": 60, "5m": 300, "15m": 900, "30m": 1800,
    "1h": 3600, "3h": 10800, "6h": 21600, "12h": 43200,
    "24h": 86400, "3d": 259200, "7d": 604800,
    "1m": 2592000, "1y": 31536000,
}
RETENTION = WINDOWS["1y"]

def read_meminfo():
    out = {}
    for line in Path("/proc/meminfo").read_text().splitlines():
        k, v, *_ = line.split()
        out[k.rstrip(":")] = int(v) * 1024
    return out

def cpu_times():
    vals = []
    for line in Path("/proc/stat").read_text().splitlines():
        if line.startswith("cpu") and (len(line) == 3 or line[3].isdigit()):
            p = line.split()
            vals.append([int(x) for x in p[1:]])
    return vals

def read_temps():
    temps = {}
    base = Path("/sys/class/thermal")
    for zone in sorted(base.glob("thermal_zone*")):
        try:
            name = (zone / "type").read_text().strip()
            raw = float((zone / "temp").read_text().strip())
            temps[name or zone.name] = raw / 1000.0 if abs(raw) > 200 else raw
        except (OSError, ValueError):
            pass
    for hw in sorted(Path("/sys/class/hwmon").glob("hwmon*")):
        for inp in sorted(hw.glob("temp*_input")):
            try:
                raw = float(inp.read_text().strip())
                label_file = inp.with_name(inp.name.replace("_input", "_label"))
                label = label_file.read_text().strip() if label_file.exists() else inp.name
                temps[label] = raw / 1000.0 if abs(raw) > 200 else raw
            except (OSError, ValueError):
                pass
    return temps

def filesystems():
    result = {}
    seen = set()
    for line in subprocess.run(
        ["df", "-P", "-B1", "-x", "tmpfs", "-x", "devtmpfs"],
        text=True, capture_output=True, check=False
    ).stdout.splitlines()[1:]:
        p = line.split()
        if len(p) < 6:
            continue
        device, total, used, free, pct = p[:5]
        mount = " ".join(p[5:])
        if mount in seen:
            continue
        seen.add(mount)
        try:
            result[mount] = {
                "device": device,
                "total_bytes": int(total),
                "used_bytes": int(used),
                "free_bytes": int(free),
                "used_percent": float(pct.rstrip("%")),
            }
        except ValueError:
            pass
    return result

def netdev():
    result = {}
    for line in Path("/proc/net/dev").read_text().splitlines()[2:]:
        if ":" not in line:
            continue
        name, data = line.split(":", 1)
        v = data.split()
        if len(v) >= 16:
            result[name.strip()] = {
                "rx_bytes": int(v[0]), "rx_packets": int(v[1]),
                "rx_errors": int(v[2]), "rx_dropped": int(v[3]),
                "tx_bytes": int(v[8]), "tx_packets": int(v[9]),
                "tx_errors": int(v[10]), "tx_dropped": int(v[11]),
            }
    return result

def numeric(obj, prefix=""):
    out = {}
    if isinstance(obj, dict):
        for k, v in obj.items():
            out.update(numeric(v, f"{prefix}.{k}" if prefix else k))
    elif isinstance(obj, (int, float)) and not isinstance(obj, bool):
        out[prefix] = obj
    return out

now = time.time()
load1, load5, load15 = os.getloadavg()
mem = read_meminfo()
disk = filesystems()
cpus = cpu_times()
temps = read_temps()
net = netdev()

cpu = {
    "count": os.cpu_count() or 0,
    "load": {"1m": load1, "5m": load5, "15m": load15},
    "times": cpus,
}

sample = {
    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    "hostname": platform.node(),
    "platform": platform.platform(),
    "kernel": platform.release(),
    "architecture": platform.machine(),
    "uptime_seconds": float(Path("/proc/uptime").read_text().split()[0]),
    "cpu": cpu,
    "memory": {
        "total_bytes": mem.get("MemTotal", 0),
        "available_bytes": mem.get("MemAvailable", 0),
        "free_bytes": mem.get("MemFree", 0),
        "buffers_bytes": mem.get("Buffers", 0),
        "cached_bytes": mem.get("Cached", 0),
        "swap_total_bytes": mem.get("SwapTotal", 0),
        "swap_free_bytes": mem.get("SwapFree", 0),
    },
    "storage": disk,
    "temperatures_celsius": temps,
    "network": net,
    "processes": {
        "running": sum(1 for p in Path("/proc").iterdir() if p.name.isdigit())
    },
}

# SQLite stores scalar metrics only; complex JSON structures remain JSON output.
flat = numeric(sample)
columns = {k: f"m_{i}" for i, k in enumerate(sorted(flat), 1)}

with sqlite3.connect(DB) as conn:
    conn.execute("CREATE TABLE IF NOT EXISTS samples (timestamp REAL PRIMARY KEY)")
    existing = {r[1] for r in conn.execute("PRAGMA table_info(samples)")}
    for key, col in columns.items():
        if col not in existing:
            conn.execute(f'ALTER TABLE samples ADD COLUMN "{col}" REAL')
    conn.execute("CREATE INDEX IF NOT EXISTS idx_samples_timestamp ON samples(timestamp)")

    names = ["timestamp"] + list(columns.values())
    vals = [now] + [flat[k] for k in sorted(flat)]
    conn.execute(
        f'INSERT OR REPLACE INTO samples ({",".join(chr(34)+x+chr(34) for x in names)}) VALUES ({",".join("?" for _ in names)})',
        vals
    )
    conn.execute("DELETE FROM samples WHERE timestamp < ?", (now - RETENTION,))
    conn.commit()

    averages = {}
    for label, seconds in WINDOWS.items():
        cutoff = now - seconds
        cols = list(columns.values())
        select = ", ".join(f'AVG("{c}")' for c in cols)
        row = conn.execute(
            f'SELECT COUNT(*), {select} FROM samples WHERE timestamp >= ?', (cutoff,)
        ).fetchone()
        values = {}
        for key, value in zip(sorted(flat), row[1:]):
            if value is not None:
                values[key] = value
        averages[label] = {
            "sample_count": row[0],
            "window_seconds": seconds,
            "values": values,
        }

result = {**sample, "averages": averages}
tmp = OUT.with_suffix(".tmp")
tmp.write_text(json.dumps(result, indent=2) + "\n")
tmp.replace(OUT)
PY
