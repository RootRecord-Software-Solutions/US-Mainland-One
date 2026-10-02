#!/usr/bin/env python3
import importlib.util, os, signal, subprocess, time
from pathlib import Path
from datetime import datetime
JOBS=Path(__file__).with_name("jobs.py")
spec=importlib.util.spec_from_file_location("jobs",JOBS); jobs=importlib.util.module_from_spec(spec); spec.loader.exec_module(jobs)
stop=False
def sig(*_): 
    global stop
    stop=True
signal.signal(signal.SIGTERM,sig); signal.signal(signal.SIGINT,sig)
def run(j):
    if j.get("needs_internet"):
        import socket
        try:
            with socket.create_connection(("1.1.1.1",443),2): pass
        except OSError: return
    try:
        subprocess.run(["bash","-lc",j["command"]],cwd=j.get("cwd") or None,env={**os.environ,**{str(k):str(v) for k,v in (j.get("env") or {}).items()}},timeout=float(j.get("timeout_sec",20)),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    except Exception: pass
due={j["id"]:0.0 for j in jobs.EVERY_SECONDS if j.get("enabled")}
print(datetime.now().astimezone().isoformat(timespec="seconds")+" Mainland poller online — 1s cadence",flush=True)
while not stop:
    now=time.monotonic()
    for j in jobs.EVERY_SECONDS:
        if j.get("enabled") and now>=due[j["id"]]:
            run(j); due[j["id"]]=now+max(1.0,float(j.get("interval_sec",1)))
    time.sleep(0.1)
