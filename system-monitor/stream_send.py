#!/usr/bin/env python3
"""SSH-stream sysmon handoffs to Pacific (same NDJSON contract as ML2 stream)."""
from __future__ import annotations

import argparse
import base64
import json
import os
import subprocess
import sys
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parents[1]
VAR = Path(os.environ.get("RR_SYSMON_VAR", str(REPO / "var" / "sysmon")))
HANDOFF = VAR / "handoff"
STATE = VAR / "state"
CFG = REPO / "config" / "sysmon-stream.yaml"

ALLOWED = (
    "System/metrics/ml1/",
    "System/metrics/ml1/",
    "Logs/ML1/",
    "Logs/ML2/",
    "Intake/ml1/",
    "Intake/ml2/",
)


def load_cfg() -> dict:
    if CFG.exists():
        return yaml.safe_load(CFG.read_text(encoding="utf-8")) or {}
    return {}


def iter_envelopes():
    if not HANDOFF.exists():
        return
    for env_path in sorted(HANDOFF.glob("*.envelope.json")):
        try:
            env = json.loads(env_path.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"sysmon-stream: bad envelope {env_path}: {e}", file=sys.stderr)
            continue
        rel = env.get("staging_file")
        if not rel:
            continue
        body_path = HANDOFF / rel
        if not body_path.is_file():
            continue
        path_rel = env.get("path_rel") or ""
        if not any(path_rel.startswith(p) for p in ALLOWED):
            print(f"sysmon-stream: reject {path_rel!r}", file=sys.stderr)
            continue
        low = path_rel.lower()
        if "ecoflow" in low or path_rel.startswith("Energy/"):
            print(f"sysmon-stream: deny Energy/EcoFlow {path_rel}", file=sys.stderr)
            env_path.unlink(missing_ok=True)
            body_path.unlink(missing_ok=True)
            continue
        raw = body_path.read_bytes()
        line = {
            "schema_version": env.get("schema_version", 1),
            "source_node": env.get("source_node"),
            "domain": env.get("domain") or "sysmon",
            "path_rel": path_rel,
            "content_type": env.get("content_type") or "application/json",
            "collected_at": env.get("collected_at"),
            "ok": env.get("ok", True),
            "error": env.get("error"),
            "meta": env.get("meta") or {},
            "body_b64": base64.b64encode(raw).decode("ascii"),
            "bytes": len(raw),
        }
        yield line, env_path, body_path


def build_ssh(cfg: dict) -> list[str]:
    host = os.environ.get("RR_SYSMON_SSH_HOST") or cfg.get("ssh_host") or "pacific-db"
    user = os.environ.get("RR_SYSMON_SSH_USER") or cfg.get("ssh_user") or "rootrecord"
    port = int(os.environ.get("RR_SYSMON_SSH_PORT") or cfg.get("ssh_port") or 22)
    key = os.environ.get("RR_SYSMON_SSH_KEY") or cfg.get("ssh_identity_file") or ""
    receiver = (
        os.environ.get("RR_SYSMON_RECEIVER")
        or cfg.get("receiver_command")
        or "python3 /home/rootrecord/RootRecord-Ecosystem/1\\ -\\ Servers/1\\ -\\ RootRecord-Pacific-Solar-Server/System/scripts/rr_db_stream_receive.py"
    )
    cmd = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=20",
           "-o", "StrictHostKeyChecking=accept-new", "-p", str(port)]
    if key:
        cmd.extend(["-i", key])
    target = f"{user}@{host}" if "@" not in host else host
    cmd.extend([target, receiver])
    return cmd


def purge(paths):
    for env_path, body_path in paths:
        try:
            env_path.unlink(missing_ok=True)
            body_path.unlink(missing_ok=True)
        except OSError as e:
            print(f"sysmon-stream: purge warn {e}", file=sys.stderr)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--keep", action="store_true")
    args = ap.parse_args(argv)
    cfg = load_cfg()
    if not cfg.get("enabled", False) and not args.dry_run:
        print("sysmon-stream: disabled (config/sysmon-stream.yaml enabled: false)")
        return 2  # distinct: disabled / not attempted
    items = list(iter_envelopes())
    if not items:
        print("sysmon-stream: nothing to send")
        return 0
    payload = "".join(json.dumps(l, separators=(",", ":")) + "\n" for l, _, _ in items)
    STATE.mkdir(parents=True, exist_ok=True)
    if args.dry_run:
        sys.stdout.write(payload)
        print(f"sysmon-stream: dry-run {len(items)}", file=sys.stderr)
        return 0
    cmd = build_ssh(cfg)
    try:
        proc = subprocess.run(
            cmd,
            input=payload.encode("utf-8"),
            capture_output=True,
            timeout=int(cfg.get("timeout_sec") or 90),
            check=False,
        )
    except Exception as e:
        print(f"sysmon-stream: FAIL {e}", file=sys.stderr)
        (STATE / "stream-last.json").write_text(
            json.dumps({"ok": False, "error": str(e)}, indent=2) + "\n", encoding="utf-8"
        )
        return 1
    (STATE / "stream-last.json").write_text(
        json.dumps(
            {
                "ok": proc.returncode == 0,
                "sent": len(items),
                "returncode": proc.returncode,
                "stdout_tail": (proc.stdout or b"")[-1500:].decode("utf-8", "replace"),
                "stderr_tail": (proc.stderr or b"")[-1500:].decode("utf-8", "replace"),
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    if proc.returncode != 0:
        print(f"sysmon-stream: remote rc={proc.returncode}", file=sys.stderr)
        return 1
    if not args.keep and cfg.get("delete_after_ack", True):
        purge([(e, b) for _, e, b in items])
    print(f"sysmon-stream: ok sent={len(items)} purged_after_ack")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
