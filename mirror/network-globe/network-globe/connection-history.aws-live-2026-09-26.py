#!/usr/bin/env python3
import json, os, sqlite3, time, urllib.request, uuid, zipfile
from pathlib import Path

FEED=Path(os.environ.get("GLOBE_FEED","/home/ubuntu/network-globe/network-globe/data/hawaii.ndjson"))
DB=Path(os.environ.get("GLOBE_DB","/home/ubuntu/network-globe/network-globe/data/hawaii-connections.sqlite3"))
MASTER=Path("/home/ubuntu/master/master-key.env")

def load_env():
    for p in (MASTER,Path("/home/ubuntu/.env")):
        if not p.exists(): continue
        for line in p.read_text(errors="ignore").splitlines():
            line=line.strip()
            if line and not line.startswith("#") and "=" in line:
                k,v=line.split("=",1); os.environ.setdefault(k.strip(),v.strip().strip("'\""))

def day():
    return time.strftime("%Y-%m-%d",time.gmtime(time.time()-10*3600))

def init():
    DB.parent.mkdir(parents=True,exist_ok=True)
    c=sqlite3.connect(DB)
    c.execute("""CREATE TABLE IF NOT EXISTS connections(
      day TEXT NOT NULL, source_node TEXT, source_region TEXT,
      destination_ip TEXT NOT NULL, destination_port INTEGER,
      protocol TEXT, process TEXT, first_seen INTEGER NOT NULL,
      last_seen INTEGER NOT NULL, observations INTEGER NOT NULL,
      packets INTEGER NOT NULL, bytes INTEGER NOT NULL,
      PRIMARY KEY(day,source_node,source_region,destination_ip,destination_port,protocol,process)
    )""")
    c.commit(); return c

def ingest(c,r):
    if r.get("type")!="network-globe-telemetry": return
    d=r.get("destination") or {}
    ip=d.get("ip")
    if not ip: return
    ts=int(r.get("timestamp") or time.time()*1000)
    vals=(day(),r.get("sourceNode"),r.get("sourceRegion"),ip,int(d.get("port") or 0),
          r.get("protocol"),r.get("process") or "unknown",ts,ts,1,
          int(r.get("packets") or 0),int(r.get("bytes") or 0))
    c.execute("""INSERT INTO connections VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(day,source_node,source_region,destination_ip,destination_port,protocol,process)
      DO UPDATE SET last_seen=excluded.last_seen, observations=observations+1,
      packets=packets+excluded.packets, bytes=bytes+excluded.bytes""",vals)
    c.commit()

def send_daily():
    load_env()
    token=(os.environ.get("RR_DATAPACK_SEND_BOT_TOKEN") or os.environ.get("RR_DATAPACK_BOT_TOKEN") or os.environ.get("RR_TELEGRAM_BOT_TOKEN") or "").strip()
    chat=(os.environ.get("RR_DATAPACK_CHAT_ID") or "").strip()
    if not token or not chat or not DB.exists(): return False
    z=DB.with_suffix(".zip")
    with zipfile.ZipFile(z,"w",zipfile.ZIP_DEFLATED) as f: f.write(DB,DB.name)
    boundary="rr"+uuid.uuid4().hex
    payload=(f"--{boundary}\r\nContent-Disposition: form-data; name=\"chat_id\"\r\n\r\n{chat}\r\n"
      f"--{boundary}\r\nContent-Disposition: form-data; name=\"caption\"\r\n\r\nNetwork Globe daily SQLite {day()}\r\n"
      f"--{boundary}\r\nContent-Disposition: form-data; name=\"document\"; filename=\"{DB.name}\"\r\n"
      f"Content-Type: application/octet-stream\r\n\r\n").encode()+DB.read_bytes()+f"\r\n--{boundary}--\r\n".encode()
    req=urllib.request.Request("https://api.telegram.org/bot"+token+"/sendDocument",data=payload,
      headers={"Content-Type":f"multipart/form-data; boundary={boundary}"})
    try:
        with urllib.request.urlopen(req,timeout=30) as r: ok=json.loads(r.read()).get("ok",False)
    except Exception: ok=False
    try: z.unlink()
    except FileNotFoundError: pass
    if ok: DB.unlink()
    return ok

def main():
    c=init(); offset=0; previous=day()
    while True:
        if FEED.exists():
            size=FEED.stat().st_size
            if size<offset: offset=0
            if size>offset:
                with FEED.open("rb") as f:
                    f.seek(offset); chunk=f.read(min(2*1024*1024,size-offset))
                lines=chunk.splitlines()
                offset += sum(len(x)+1 for x in lines)
                for raw in lines:
                    try: ingest(c,json.loads(raw))
                    except Exception: pass
        current=day()
        if current!=previous:
            c.close()
            if send_daily(): pass
            previous=current; c=init()
        time.sleep(1)

if __name__=="__main__": main()
