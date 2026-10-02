#!/usr/bin/env python3
"""rr_fallback_tick.py: AWS fallback runtime, ONE tick (rr-fallback-runner.timer, every 30 s).

INFO (future agents): must read
- Desk-canonical. Source: US-Mainland-One `fallback/`, deployed by `fallback/deploy-aws-fallback.sh`.
  Never edit on AWS. Design: Library 08-ideas/2026-09-29-aws-fallback-rebuild.md.
- Oneshot on a timer, so there is 0 MB resident between ticks. Stdlib only, lazy imports.
- Truth = ~/rootrecord/fallback/flags/<id> ("1"/"0"). Service-type flags are applied by the root
  rr-fallback-apply (path unit), NOT here. This tick runs only the in-process functions:
  desk_watch, relay_buffer (packing; sending needs flags/relay_send=1), system_monitor, plus status and retention.
- Guard: a function starts only if MemAvailable - ram_mb >= ram_floor_mb and disk free >= disk_floor_mb
  (budget.json), otherwise BUDGET_SKIP. desk_watch / status are exempt (no allocation).
- No secrets are read unless relay_send=1 (then ~/.env RR_DATAPACK_* only, never logged).
"""
import json
import os
import re
import sys
import time

ROOT = os.path.expanduser(os.environ.get("RR_FALLBACK_ROOT", "~/rootrecord/fallback"))
FEED = os.environ.get("RR_FALLBACK_FEED", "/home/ubuntu/network-globe/network-globe/data/hawaii.ndjson")
ID_RE = re.compile(r"^[a-z0-9_]{2,40}$")
SUSPECT_SEC, FALLBACK_SEC, FRESH_SEC, FRESH_STREAK = 120, 300, 120, 3
SPOOL_CAP = 256 * 1024 * 1024
NOW = time.time()


def P(*a):
    return os.path.join(ROOT, *a)


def hst(t=None):
    return time.strftime("%Y-%m-%d %H:%M:%S HST", time.gmtime((t or NOW) - 36000))


def rjson(p, default):
    try:
        with open(p) as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def wjson(p, obj):
    tmp = p + ".tmp"
    with open(tmp, "w") as f:
        json.dump(obj, f, separators=(",", ":"), sort_keys=True)
    os.replace(tmp, p)


def event(kind, **kw):
    kw.update(ts=int(NOW), hst=hst(), event=kind)
    with open(P("logs", "events.log"), "a") as f:
        f.write(json.dumps(kw, sort_keys=True) + "\n")


def flags():
    out = {}
    try:
        names = os.listdir(P("flags"))
    except OSError:
        return out
    for n in names:
        if ID_RE.match(n):
            try:
                with open(P("flags", n)) as f:
                    out[n] = f.read(8).strip() == "1"
            except OSError:
                pass
    return out


def mem():
    m = {}
    with open("/proc/meminfo") as f:
        for ln in f:
            k, v = ln.split(":", 1)
            if k in ("MemTotal", "MemAvailable"):
                m[k] = int(v.split()[0]) // 1024
    return m.get("MemTotal", 0), m.get("MemAvailable", 0)


def disk_free_mb():
    s = os.statvfs(ROOT)
    return s.f_bavail * s.f_frsize // (1024 * 1024)


def counter(name):
    p = P("state", name)
    n = int(rjson(p, {"n": 0}).get("n", 0)) + 1
    wjson(p, {"n": n})
    return n


def spool(source, key, payload):
    """Append one envelope; id = sha256(source|natural key) so the desk can dedupe."""
    import hashlib
    d = P("spool", source)
    os.makedirs(d, exist_ok=True)
    env = {"id": hashlib.sha256(f"{source}|{key}".encode()).hexdigest(), "source": source,
           "observed_at": int(NOW), "collected_by": "aws", "seq": counter("rec_seq"), "payload": payload}
    seg = time.strftime("%Y%m%d-%H", time.gmtime(NOW - 36000)) + ".ndjson"
    with open(os.path.join(d, seg), "a") as f:
        f.write(json.dumps(env, sort_keys=True) + "\n")


# ---------------------------------------------------------------- functions
def desk_watch(st):
    ages = {}
    for name, p in (("feed", FEED), ("heartbeat", P("state", "desk-heartbeat"))):
        try:
            ages[name] = int(NOW - os.stat(p).st_mtime)
        except OSError:
            pass
    age = min(ages.values()) if ages else 10 ** 9
    w = rjson(P("state", "desk_watch.json"), {"mode": "NORMAL", "since": int(NOW), "fresh": 0})
    old = w["mode"]
    if age < FRESH_SEC:
        w["fresh"] = w.get("fresh", 0) + 1
        if old != "NORMAL" and w["fresh"] >= FRESH_STREAK:
            w["mode"] = "NORMAL"
    else:
        w["fresh"] = 0
        if age >= FALLBACK_SEC:
            w["mode"] = "FALLBACK"
        elif old == "NORMAL":
            w["mode"] = "SUSPECT"
    if w["mode"] != old:
        w["since"] = int(NOW)
        event("mode", old=old, new=w["mode"], desk_age_s=age, signals=ages)
        spool("aws_mode", f"{int(NOW)}|{w['mode']}", {"old": old, "new": w["mode"], "desk_age_s": age})
    w.update(desk_age_s=age, signals=ages, checked=int(NOW))
    wjson(P("state", "desk_watch.json"), w)
    with open(P("state", "mode.tmp"), "w") as f:
        f.write(w["mode"] + "\n")
    os.replace(P("state", "mode.tmp"), P("state", "mode"))
    st["mode"], st["desk_age_s"] = w["mode"], age
    if w["mode"] == "FALLBACK":   # outage timeline for the desk (5-min snapshots)
        last = rjson(P("state", "aws_status.last"), {}).get("t", 0)
        if NOW - last >= 300:
            tot, av = mem()
            spool("aws_status", time.strftime("%Y%m%d%H%M", time.gmtime(NOW)),
                  {"mem_avail_mb": av, "disk_free_mb": disk_free_mb(), "load": os.getloadavg(), "desk_age_s": age})
            wjson(P("state", "aws_status.last"), {"t": int(NOW)})
    return "ok " + w["mode"]


def relay_buffer(st, fl):
    """Pack spool segments -> outbox zip + manifest; send only if flags/relay_send=1; prune by desk-ack + cap."""
    import hashlib
    import zipfile
    outbox = P("spool", "outbox")
    os.makedirs(outbox, exist_ok=True)
    segs = []
    for src in sorted(os.listdir(P("spool"))):
        d = P("spool", src)
        if src == "outbox" or not os.path.isdir(d):
            continue
        segs += [os.path.join(d, n) for n in sorted(os.listdir(d)) if n.endswith(".ndjson")]
    res = "nothing to pack"
    if segs and st.get("mode") != "SUSPECT":   # FALLBACK: every 15 min; back in NORMAL: one final pack
        seq = counter("pack_seq")
        name = f"rr-aws-{time.strftime('%Y%m%d-%H%M', time.gmtime(NOW - 36000))}-{seq:06d}.zip"
        man = {"pack": name, "pack_seq": seq, "created": int(NOW), "created_hst": hst(), "files": []}
        tmp = os.path.join(outbox, "." + name)
        with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
            for s in segs:
                data = open(s, "rb").read()
                arc = os.path.relpath(s, P("spool"))
                z.writestr(arc, data)
                man["files"].append({"name": arc, "bytes": len(data), "lines": data.count(b"\n"),
                                     "sha256": hashlib.sha256(data).hexdigest()})
            z.writestr("manifest.json", json.dumps(man, indent=1))
        os.replace(tmp, os.path.join(outbox, name))
        for s in segs:
            os.remove(s)
        event("packed", pack=name, files=len(segs))
        res = f"packed {name} ({len(segs)} segs)"
    # send (sign-off: relay_send), never in NORMAL: the desk pulls directly then
    sent = rjson(P("state", "relay_sent.json"), {})
    if fl.get("relay_send") and st.get("mode") == "FALLBACK":
        for n in sorted(os.listdir(outbox)):
            if n.endswith(".zip") and n not in sent:
                ok = send_document(os.path.join(outbox, n))
                sent[n] = {"ok": ok, "t": int(NOW)}
                event("relay_send", pack=n, ok=ok)
                if not ok:
                    break
        wjson(P("state", "relay_sent.json"), sent)
    # prune: acked by the desk (state/desk-ack = highest pack_seq ingested), then hard cap oldest-first
    ack = int(rjson(P("state", "desk-ack.json"), {}).get("pack_seq", 0))
    zips = sorted(n for n in os.listdir(outbox) if n.endswith(".zip"))
    for n in zips:
        try:
            if int(n.rsplit("-", 1)[1][:-4]) <= ack:
                os.remove(os.path.join(outbox, n)); event("pruned_acked", pack=n)
        except (ValueError, IndexError, OSError):
            pass
    total = 0
    for dp, _, fs in os.walk(P("spool")):
        total += sum(os.path.getsize(os.path.join(dp, f)) for f in fs)
    for n in sorted(n for n in os.listdir(outbox) if n.endswith(".zip")):
        if total <= SPOOL_CAP:
            break
        sz = os.path.getsize(os.path.join(outbox, n)); os.remove(os.path.join(outbox, n)); total -= sz
        event("dropped_cap", pack=n, bytes=sz)
    return res + f"; outbox {len(os.listdir(outbox))} files; spool {total // 1024} KB"


def send_document(path):
    import urllib.request
    import uuid
    env = {}
    try:
        for ln in open(os.path.expanduser("~/.env"), errors="ignore"):
            if "=" in ln and not ln.lstrip().startswith("#"):
                k, v = ln.split("=", 1)
                env[k.strip()] = v.strip().strip("'\"")
    except OSError:
        return False
    tok, chat = env.get("RR_DATAPACK_SEND_BOT_TOKEN", ""), env.get("RR_DATAPACK_CHAT_ID", "")
    if not tok or not chat:
        return False
    b = "rr" + uuid.uuid4().hex
    body = (f"--{b}\r\nContent-Disposition: form-data; name=\"chat_id\"\r\n\r\n{chat}\r\n"
            f"--{b}\r\nContent-Disposition: form-data; name=\"caption\"\r\n\r\nAWS fallback packet {os.path.basename(path)}\r\n"
            f"--{b}\r\nContent-Disposition: form-data; name=\"document\"; filename=\"{os.path.basename(path)}\"\r\n"
            "Content-Type: application/zip\r\n\r\n").encode() + open(path, "rb").read() + f"\r\n--{b}--\r\n".encode()
    req = urllib.request.Request(f"https://api.telegram.org/bot{tok}/sendDocument", data=body,
                                 headers={"Content-Type": f"multipart/form-data; boundary={b}"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return bool(json.loads(r.read()).get("ok"))
    except Exception:
        return False


def system_monitor(st):
    tot, av = mem()
    with open("/proc/uptime") as f:
        up = float(f.read().split()[0])
    wjson(P("data", "current", "system_monitor.json"),
          {"ts": int(NOW), "hst": hst(), "mem_total_mb": tot, "mem_avail_mb": av, "disk_free_mb": disk_free_mb(),
           "load": os.getloadavg(), "uptime_s": int(up)})
    return f"ok avail {av} MB"


BAK_RE = re.compile(r"^bin\.bak-(.+)-(\d{8}-\d{6})$")


def retention(st):
    """Daily: ~/rootrecord/bin.bak-<kind>-<ts> older than 14 days, keeping the newest per kind; releases keep 5."""
    import shutil
    base = os.path.dirname(ROOT)   # ~/rootrecord
    kinds = {}
    for n in os.listdir(base):
        m = BAK_RE.match(n)
        if m and os.path.isdir(os.path.join(base, n)) and not os.path.islink(os.path.join(base, n)):
            kinds.setdefault(m.group(1), []).append(n)
    removed = []
    for kind, names in kinds.items():
        for n in sorted(names, key=lambda x: BAK_RE.match(x).group(2))[:-1]:
            if NOW - os.path.getmtime(os.path.join(base, n)) > 14 * 86400:
                shutil.rmtree(os.path.join(base, n)); removed.append(n)
    rel = P("releases")
    keep = {os.path.basename(os.path.dirname(os.path.realpath(P(x)))) for x in ("app", "app.prev") if os.path.islink(P(x))}
    if os.path.isdir(rel):
        for n in sorted(os.listdir(rel))[:-5]:
            if n not in keep:
                shutil.rmtree(os.path.join(rel, n)); removed.append("releases/" + n)
    if removed:
        event("retention", removed=removed)
    return f"ok removed {len(removed)}"


# name: (fn, interval_s, ram_mb for the guard, needs flag)
TASKS = [("desk_watch", 0, 0, True), ("relay_buffer", 900, 5, True), ("system_monitor", 60, 1, True),
         ("retention", 86400, 2, False)]
IN_RELEASE = {"desk_watch", "relay_buffer", "system_monitor", "relay_send"}
SERVICE_IDS = {"tunnel", "globe_ingest", "globe_web", "globe_history", "globe_feed_8787", "github_poller",
               "legacy_poller", "public_ip_notify"}


def main():
    for d in ("flags", "state", "logs", "spool", os.path.join("data", "current")):
        os.makedirs(P(d), exist_ok=True)
    budget = rjson(P("budget.json"), {"ram_floor_mb": 485, "disk_floor_mb": 1536})
    fl = flags()
    last = rjson(P("state", "last.json"), {})
    st = {"mode": rjson(P("state", "desk_watch.json"), {}).get("mode", "NORMAL")}
    results = {}
    for name, every, ram, needs_flag in TASKS:
        if needs_flag and not fl.get(name):
            results[name] = "off"
            continue
        if NOW - last.get(name, {}).get("t", 0) < every - 5:
            results[name] = last.get(name, {}).get("r", "waiting")
            continue
        tot, av = mem()
        dfree = disk_free_mb()
        if ram and (av - ram < budget["ram_floor_mb"] or dfree < budget["disk_floor_mb"]):
            r = f"BUDGET_SKIP avail {av} MB, disk {dfree} MB"
            if not str(last.get(name, {}).get("r", "")).startswith("BUDGET_SKIP"):
                event("budget_skip", fn=name, avail_mb=av, disk_mb=dfree)   # logged once per skip streak
            last[name] = {"t": last.get(name, {}).get("t", 0), "r": r}    # not "ran": retried next tick
            results[name] = r
            continue
        else:
            try:
                r = (relay_buffer(st, fl) if name == "relay_buffer" else globals()[name](st))
            except Exception as e:   # one function failing must not stop the others
                r = f"ERROR {type(e).__name__}: {e}"[:200]
                event("error", fn=name, err=r)
        last[name] = {"t": int(NOW), "r": r}
        results[name] = r
    wjson(P("state", "last.json"), last)
    for fid, on in fl.items():
        if fid not in results and on and fid not in SERVICE_IDS and fid not in IN_RELEASE:
            results[fid] = "not_in_release"
    tot, av = mem()
    hist = rjson(P("state", "mem_history.json"), [])[-119:] + [[int(NOW), av, disk_free_mb()]]   # ~1 h at 30 s
    wjson(P("state", "mem_history.json"), hist)
    rel = os.path.basename(os.path.dirname(os.path.realpath(P("app")))) if os.path.islink(P("app")) else "unversioned"
    wjson(P("data", "current", "status.json"),
          {"ts": int(NOW), "hst": hst(), "release": rel, "mode": st.get("mode"), "desk_age_s": st.get("desk_age_s"),
           "mem_total_mb": tot, "mem_avail_mb": av, "disk_free_mb": disk_free_mb(), "floors": budget,
           "flags": fl, "functions": results})
    return 0


if __name__ == "__main__":
    sys.exit(main())
