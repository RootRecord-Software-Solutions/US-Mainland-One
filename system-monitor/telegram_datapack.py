#!/usr/bin/env python3
"""Telegram datapack fallback when Pacific SSH is unreachable.

Free buffer: Telegram cloud holds the document. Mainland purges AFTER
Telegram API accepts sendDocument. Do not stack local copies.
Uses a dedicated datapack bot token (not the council-relay getUpdates owner).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
VAR = Path(os.environ.get("RR_SYSMON_VAR", str(REPO / "var" / "sysmon")))
HANDOFF = VAR / "handoff"
STATE = VAR / "state"
OUTBOX = VAR / "telegram-outbox"  # brief only; wiped after accept


def _env_file_load(path: Path) -> dict:
    d = {}
    if not path.is_file():
        return d
    try:
        for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                k, v = line.strip().split("=", 1)
                d[k] = v.split("#", 1)[0].strip().strip("'\"")
    except OSError:
        pass
    return d


def credentials() -> tuple[str, str]:
    env = {}
    for p in (
        Path(os.environ.get("RR_SYSMON_ENV", "")),
        Path("/home/ubuntu/.env"),
        Path("/etc/rootrecord/sysmon.env"),
        REPO / ".env",
    ):
        if p and str(p) != "." and p.is_file():
            env.update(_env_file_load(p))
    token = (
        os.environ.get("RR_DATAPACK_SEND_BOT_TOKEN")
        or os.environ.get("RR_DATAPACK_BOT_TOKEN")
        or env.get("RR_DATAPACK_SEND_BOT_TOKEN")
        or env.get("RR_DATAPACK_BOT_TOKEN")
        or ""
    )
    chat = (
        os.environ.get("RR_DATAPACK_CHAT_ID")
        or env.get("RR_DATAPACK_CHAT_ID")
        or env.get("ROOTRECORD_DATA_RELAY_TG")
        or ""
    )
    return token, chat


def collect_files():
    files = []
    if not HANDOFF.exists():
        return files
    for env_path in sorted(HANDOFF.glob("*.envelope.json")):
        try:
            env = json.loads(env_path.read_text(encoding="utf-8"))
        except Exception:
            continue
        rel = env.get("staging_file")
        body = HANDOFF / rel if rel else None
        if body and body.is_file():
            files.append((env_path, body, env))
    return files


def build_zip(files, dest: Path, source_node: str) -> Path:
    dest.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    zpath = dest / f"rootrecord-sysmon-{source_node}-{stamp}.zip"
    with zipfile.ZipFile(zpath, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        manifest = {
            "kind": "mainland_sysmon_datapack",
            "schema_version": 1,
            "source_node": source_node,
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "files": [],
            "pacific_pickup": "Communications/telegram/scripts/datapack-pickup.py",
            "db_dest_hint": "System/metrics/",
        }
        for env_path, body, env in files:
            arc_body = f"handoff/{body.name}"
            arc_env = f"handoff/{env_path.name}"
            zf.write(body, arc_body)
            zf.write(env_path, arc_env)
            manifest["files"].append(
                {
                    "body": arc_body,
                    "envelope": arc_env,
                    "path_rel": env.get("path_rel"),
                    "source_node": env.get("source_node"),
                }
            )
        zf.writestr("manifest.json", json.dumps(manifest, indent=2) + "\n")
    return zpath


def send_document(token: str, chat_id: str, zpath: Path, caption: str) -> dict:
    # multipart via stdlib
    boundary = f"----rrsysmon{int(time.time())}"
    url = f"https://api.telegram.org/bot{token}/sendDocument"
    file_bytes = zpath.read_bytes()
    body = []
    def add(name, value):
        body.append(f"--{boundary}\r\n".encode())
        body.append(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode())
        body.append(value if isinstance(value, bytes) else str(value).encode())
        body.append(b"\r\n")
    add("chat_id", chat_id)
    add("caption", caption[:1024])
    body.append(f"--{boundary}\r\n".encode())
    body.append(
        f'Content-Disposition: form-data; name="document"; filename="{zpath.name}"\r\n'.encode()
    )
    body.append(b"Content-Type: application/zip\r\n\r\n")
    body.append(file_bytes)
    body.append(b"\r\n")
    body.append(f"--{boundary}--\r\n".encode())
    data = b"".join(body)
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


def purge_handoff(files):
    for env_path, body, _ in files:
        try:
            env_path.unlink(missing_ok=True)
            body.unlink(missing_ok=True)
        except OSError as e:
            print(f"telegram-datapack: purge warn {e}", file=sys.stderr)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--source-node", default=os.environ.get("RR_SYSMON_SOURCE_NODE", "mainland"))
    args = ap.parse_args(argv)
    files = collect_files()
    if not files:
        print("telegram-datapack: nothing to send")
        return 0
    token, chat = credentials()
    STATE.mkdir(parents=True, exist_ok=True)
    if args.dry_run:
        print(json.dumps({"would_send": len(files), "chat_set": bool(chat), "token_set": bool(token)}, indent=2))
        return 0
    if not token or not chat:
        print("telegram-datapack: missing RR_DATAPACK_* token/chat", file=sys.stderr)
        return 1
    OUTBOX.mkdir(parents=True, exist_ok=True)
    # wipe any prior outbox zip (never stack)
    for old in OUTBOX.glob("rootrecord-sysmon-*.zip"):
        try:
            old.unlink()
        except OSError:
            pass
    zpath = build_zip(files, OUTBOX, args.source_node)
    caption = (
        f"RR_DATAPACK sysmon source={args.source_node} files={len(files)} "
        f"pickup=datapack-pickup.py dest=System/metrics/"
    )
    try:
        result = send_document(token, chat, zpath, caption)
    except Exception as e:
        print(f"telegram-datapack: send FAIL {e}", file=sys.stderr)
        (STATE / "telegram-last.json").write_text(
            json.dumps({"ok": False, "error": str(e), "zip": str(zpath)}, indent=2) + "\n",
            encoding="utf-8",
        )
        return 1
    ok = bool(result.get("ok"))
    (STATE / "telegram-last.json").write_text(
        json.dumps(
            {
                "ok": ok,
                "zip": zpath.name,
                "message_id": (result.get("result") or {}).get("message_id"),
                "document": ((result.get("result") or {}).get("document") or {}).get("file_id"),
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    if not ok:
        print(f"telegram-datapack: API not ok: {result}", file=sys.stderr)
        return 1
    # accepted → purge Mainland handoff AND local zip (Telegram is the free buffer)
    purge_handoff(files)
    try:
        zpath.unlink(missing_ok=True)
    except OSError:
        pass
    print(f"telegram-datapack: ok sent zip; local purged (Telegram is buffer)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
