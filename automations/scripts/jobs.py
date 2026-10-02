# Mainland job catalog — RootRecord scheduler.
DEFAULTS = {"enabled": False, "timeout_sec": 120, "cwd": "", "env": {}}

ON_BOOT = [
    {"id":"self_process","enabled":True,"priority":0,"builtin":"self_process","command":"","timeout_sec":5,"cwd":"","env":{}},
    {"id":"globe_feed","enabled":True,"priority":1,"builtin":"","command":"systemctl enable --now network-globe-feed-server.service network-globe-connection-history.service","timeout_sec":30,"cwd":"/home/ubuntu/network-globe/network-globe","env":{}},
]
ONCE_AT_START = []

EVERY_SECONDS = [
    {"id":"system_monitor","enabled":True,"description":"Current JSON system monitor + rolling averages.","interval_sec":1,"builtin":"","command":"sudo -u ubuntu bash /home/ubuntu/system-monitor/sys-sample.sh","timeout_sec":20,"cwd":"/home/ubuntu/system-monitor","env":{}},
    {"id":"communications_telegram","enabled":True,"description":"Telegram communications poller.","interval_sec":1,"builtin":"","command":"sudo -u ubuntu python3 /home/ubuntu/communications/telegram/poll.py","timeout_sec":20,"needs_internet":True,"cwd":"/home/ubuntu/communications/telegram","env":{}},
    {"id":"communications_discord","enabled":True,"description":"Discord communications poller.","interval_sec":1,"builtin":"","command":"sudo -u ubuntu python3 /home/ubuntu/communications/discord/poll.py","timeout_sec":20,"needs_internet":True,"cwd":"/home/ubuntu/communications/discord","env":{}},
    {"id":"communications_slack","enabled":True,"description":"Slack communications poller.","interval_sec":1,"builtin":"","command":"sudo -u ubuntu python3 /home/ubuntu/communications/slack/poll.py","timeout_sec":20,"needs_internet":True,"cwd":"/home/ubuntu/communications/slack","env":{}},
]

EVERY_MINUTE = [
    {"id":"public_ip_notify","enabled":True,"builtin":"public_ip_notify","command":"","timeout_sec":30,"needs_internet":True,"cwd":"","env":{}},
    {"id":"github_pull","enabled":True,"builtin":"","command":"git fetch origin main --quiet && git merge --ff-only origin/main","timeout_sec":60,"needs_internet":True,"cwd":"/home/ubuntu/US-Mainland-Server","env":{}},
]
EVERY_HOUR = []
ON_AT = []
