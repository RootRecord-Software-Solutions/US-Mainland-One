#!/usr/bin/env python3
"""Thin ML1 EXACT_TIME poller — same scheduling rules as Pacific rootserver_poller."""
from __future__ import annotations

import importlib.util
import os
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

HST = ZoneInfo("Pacific/Honolulu")
ROOT = Path(__file__).resolve().parents[1]
JOBS_PATH = ROOT / "scripts" / "jobs.py"


def load_jobs():
    spec = importlib.util.spec_from_file_location("ml1_jobs", JOBS_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {JOBS_PATH}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def job_on(job: dict) -> bool:
    return bool(job.get("enabled"))


def exact_due(job: dict, step: datetime) -> bool:
    every = job.get("every_seconds")
    if every:
        gap = int(every)
        phase = int(job.get("at_second") or 0) % gap
        if step.second % gap != phase:
            return False
        opened = job.get("from_minute")
        if opened is not None and step.minute < int(opened):
            return False
        return True
    if job.get("at_hour") is not None and int(job["at_hour"]) != step.hour:
        return False
    if int(job.get("at_minute") or 0) != step.minute:
        return False
    if int(job.get("at_second") or 0) != step.second:
        return False
    return True


def run_job(job: dict) -> int:
    cmd = (job.get("command") or "").strip()
    if not cmd:
        print(f"ml1-poller: skip {job.get('id')} (no command)", flush=True)
        return 0
    cwd = job.get("cwd") or str(ROOT)
    env = os.environ.copy()
    for k, v in (job.get("env") or {}).items():
        env[str(k)] = str(v)
    timeout = int(job.get("timeout_sec") or 120)
    print(f"ml1-poller: run {job.get('id')} @ {datetime.now(HST).strftime('%H:%M:%S')}", flush=True)
    try:
        r = subprocess.run(["bash", "-lc", cmd], cwd=cwd, env=env, timeout=timeout)
        return int(r.returncode)
    except subprocess.TimeoutExpired:
        print(f"ml1-poller: timeout {job.get('id')}", file=sys.stderr, flush=True)
        return 124


def main() -> int:
    jobs = load_jobs()
    for job in getattr(jobs, "ON_BOOT", []) or []:
        if isinstance(job, dict) and job_on(job):
            run_job(job)

    fired: set[tuple[str, int, int, int]] = set()
    print(f"ml1-poller: watching EXACT_TIME from {JOBS_PATH}", flush=True)
    while True:
        now = datetime.now(HST).replace(microsecond=0)
        step = now.replace(second=(now.second // 5) * 5)
        for job in getattr(jobs, "EXACT_TIME", []) or []:
            if not isinstance(job, dict) or not job_on(job):
                continue
            if not exact_due(job, step):
                continue
            key = (str(job.get("id")), step.hour, step.minute, step.second)
            if key in fired:
                continue
            fired.add(key)
            if len(fired) > 500:
                fired = {k for k in fired if k[1:] >= (step.hour, step.minute, step.second)}
            run_job(job)
        time.sleep(0.25)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("ml1-poller: stop", flush=True)
        raise SystemExit(0)
