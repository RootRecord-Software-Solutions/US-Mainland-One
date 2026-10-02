#!/usr/bin/env python3
"""Collect ephemeral host metrics for Mainland → Pacific handoff.

Never banks on Mainland. Writes one handoff body + envelope under var/sysmon/handoff/,
then callers stream (SSH) or Telegram-datapack and purge.
EcoFlow / Energy paths are refused.
"""
from __future__ import annotations

import json
import os
import platform
import subprocess
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
VAR = Path(os.environ.get("RR_SYSMON_VAR", str(REPO / "var" / "sysmon")))
HANDOFF = VAR / "handoff"
STATE = VAR / "state"
SOURCE_NODE = os.environ.get("RR_SYSMON_SOURCE_NODE", "us-mainland-one")
PATH_REL_LAST = os.environ.get(
    "RR_SYSMON_PATH_REL",
    "System/metrics/ml1/host-last.json",
)
SCHEMA_VERSION = 1

# services: name -> systemctl unit (empty list means skip)
SERVICE_UNITS = [('cloudflared', 'cloudflared.service'), ('rr-radio-station', 'rr-radio-station.service'), ('rr-radio-watchdog-timer', 'rr-radio-watchdog.timer')]


def _now() -> str:
    return (
        datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def _read_mem():
    out = {}
    try:
        for line in Path("/proc/meminfo").read_text().splitlines():
            parts = line.split()
            if len(parts) >= 2:
                out[parts[0].rstrip(":")] = int(parts[1]) * 1024
    except OSError:
        pass
    total = out.get("MemTotal")
    avail = out.get("MemAvailable")
    used_pct = None
    if total and avail is not None and total:
        used_pct = round(100.0 * (1.0 - avail / total), 2)
    return {
        "total_bytes": total,
        "available_bytes": avail,
        "used_percent": used_pct,
        "swap_total_bytes": out.get("SwapTotal"),
        "swap_free_bytes": out.get("SwapFree"),
    }


def _read_load():
    try:
        a, b, c = os.getloadavg()
        return {"1m": a, "5m": b, "15m": c}
    except OSError:
        return {"1m": None, "5m": None, "15m": None}


def _read_uptime_sec():
    try:
        return float(Path("/proc/uptime").read_text().split()[0])
    except OSError:
        return None


def _read_disk():
    result = {}
    try:
        proc = subprocess.run(
            ["df", "-P", "-B1", "-x", "tmpfs", "-x", "devtmpfs"],
            text=True,
            capture_output=True,
            check=False,
            timeout=15,
        )
    except (OSError, subprocess.TimeoutExpired):
        return result
    for line in proc.stdout.splitlines()[1:]:
        p = line.split()
        if len(p) < 6:
            continue
        device, total, used, free, pct = p[:5]
        mount = " ".join(p[5:])
        if mount.startswith("/snap"):
            continue
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


def _cpu_brief():
    count = os.cpu_count() or 0
    # one-shot busy estimate from /proc/stat idle delta is heavy; expose counters only
    idle = total = None
    try:
        parts = Path("/proc/stat").read_text().splitlines()[0].split()
        nums = [int(x) for x in parts[1:]]
        total = sum(nums)
        idle = nums[3] if len(nums) > 3 else None
    except (OSError, ValueError, IndexError):
        pass
    return {"count": count, "stat_total": total, "stat_idle": idle}


def _systemctl_is_active(unit: str) -> str:
    try:
        proc = subprocess.run(
            ["systemctl", "is-active", unit],
            text=True,
            capture_output=True,
            check=False,
            timeout=5,
        )
        return (proc.stdout or "").strip() or (proc.stderr or "").strip() or "unknown"
    except (OSError, subprocess.TimeoutExpired):
        return "unknown"


def _service_health():
    health = {}
    for label, unit in SERVICE_UNITS:
        health[label] = {
            "unit": unit,
            "active": _systemctl_is_active(unit),
        }
    # staged collector marker (ML2): optional state file
    collect_last = Path(
        os.environ.get(
            "RR_SYSMON_COLLECT_LAST",
            str(REPO / "var" / "state" / "collect-last.json"),
        )
    )
    if collect_last.is_file():
        try:
            health["staged_collectors"] = {
                "collect_last_path": str(collect_last),
                "collect_last_mtime": collect_last.stat().st_mtime,
                "present": True,
            }
        except OSError:
            health["staged_collectors"] = {"present": False}
    return health


def build_payload() -> dict:
    mem = _read_mem()
    disk = _read_disk()
    payload = {
        "schema_version": SCHEMA_VERSION,
        "kind": "mainland_sysmon",
        "source_node": SOURCE_NODE,
        "collected_at": _now(),
        "host": {
            "hostname": platform.node(),
            "platform": platform.platform(),
            "kernel": platform.release(),
            "arch": platform.machine(),
            "uptime_sec": _read_uptime_sec(),
        },
        "cpu": _cpu_brief(),
        "load": _read_load(),
        "mem": mem,
        "disk": disk,
        "services": _service_health(),
        "meta": {
            "tz_note": "collected_at is UTC Z; host local may differ",
            "ecoflow": "never — Pacific-only",
        },
    }
    # hard refuse if anything energy-like slipped in
    blob = json.dumps(payload)
    if "EcoFlow" in blob or '"Energy/' in blob:
        raise RuntimeError("EcoFlow/Energy must not appear in Mainland sysmon payload")
    return payload


def _atomic_write(dest: Path, data: bytes) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=dest.parent, prefix=".sysmon-")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
        os.replace(tmp, dest)
    finally:
        if os.path.exists(tmp):
            try:
                os.unlink(tmp)
            except OSError:
                pass


def write_handoff(payload: dict) -> tuple[Path, Path]:
    HANDOFF.mkdir(parents=True, exist_ok=True)
    STATE.mkdir(parents=True, exist_ok=True)
    safe = PATH_REL_LAST.replace("/", "__")
    body_path = HANDOFF / safe
    env_path = HANDOFF / f"{safe}.envelope.json"
    raw = (json.dumps(payload, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
    _atomic_write(body_path, raw)
    envelope = {
        "schema_version": SCHEMA_VERSION,
        "source_node": SOURCE_NODE,
        "domain": "sysmon",
        "path_rel": PATH_REL_LAST,
        "content_type": "application/json",
        "collected_at": payload["collected_at"],
        "ok": True,
        "error": None,
        "meta": {"kind": "mainland_sysmon", "handoff": True},
        "bytes": len(raw),
        "staging_file": str(body_path.relative_to(HANDOFF)),
    }
    env_path.write_text(json.dumps(envelope, indent=2) + "\n", encoding="utf-8")
    (STATE / "collect-last.json").write_text(
        json.dumps(
            {
                "collected_at": payload["collected_at"],
                "path_rel": PATH_REL_LAST,
                "bytes": len(raw),
                "body": str(body_path),
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    return body_path, env_path


def main() -> int:
    payload = build_payload()
    body, env = write_handoff(payload)
    print(f"sysmon: handoff {body} envelope {env} path_rel={PATH_REL_LAST}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
