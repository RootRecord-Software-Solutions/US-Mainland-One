#!/usr/bin/env python3
import json, urllib.request
ENV="/home/ubuntu/.env"
def env():
    d={}
    try:
        for line in open(ENV,errors="ignore"):
            if "=" in line and not line.lstrip().startswith("#"):
                k,v=line.strip().split("=",1); d[k]=v.split("#",1)[0].strip().strip("'\"")
    except OSError: pass
    return d
e=env(); token=e.get("RR_DATAPACK_SEND_BOT_TOKEN") or e.get("API_TOKEN")
if token:
    try:
        with urllib.request.urlopen("https://api.telegram.org/bot"+token+"/getUpdates?timeout=0",timeout=3) as r:
            json.loads(r.read())
    except Exception: pass
