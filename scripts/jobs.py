# ==============================================================================
# ML1 jobs.py — same EXACT_TIME layout as Pacific Automations/scripts/jobs.py.
# Clock: Pacific/Honolulu. at_minute 0-59, at_second on 5-second slots.
# Public air is YouTube only. This catalog is air / YouTube / local ops.
# Voice generate + radio_push stay on Pacific; do not duplicate them here.
# ==============================================================================

import os

DEFAULTS = {
    "enabled": False,
    "timeout_sec": 120,
    "cwd": "",
    "env": {},
}

ML1 = os.environ.get(
    "RR_ML1_ROOT",
    "/home/ubuntu/US-Mainland-Server"
    if os.path.isdir("/home/ubuntu/US-Mainland-Server")
    else "/home/rootrecord/RootRecord-Ecosystem/1 - Servers/2 - RootRecord-US-Mainland-One",
)
DATABASE = os.environ.get(
    "RR_DATABASE_ROOT",
    "/home/rootrecord/RootRecord-Ecosystem/2 - RootRecord-Database",
)

ON_BOOT = [
    {
        "id": "ml1_self",
        "enabled": True,
        "priority": 0,
        "description": "ML1 poller self marker (no network).",
        "builtin": "",
        "command": f'echo "ml1-poller boot root={ML1}"',
        "timeout_sec": 5,
        "cwd": f"{ML1}",
        "env": {},
    },
]

ONCE_AT_START = []

EXACT_TIME = [
    {
        "id": "air_chime_boundary",
        "enabled": os.environ.get("RR_ML1_AIR_MARK", "1") == "1",
        "at_minute": 0,
        "at_second": 0,
        "description": "Air boundary :00 (mixer ducks/chimes). Marker only until playlist refine.",
        "builtin": "",
        "command": f'echo "ml1 air boundary :00 HST"',
        "timeout_sec": 5,
        "needs_internet": False,
        "cwd": f"{ML1}",
        "env": {},
    },
    {
        "id": "air_chime_boundary",
        "enabled": os.environ.get("RR_ML1_AIR_MARK", "1") == "1",
        "at_minute": 30,
        "at_second": 0,
        "description": "Air boundary :30 (mixer ducks/chimes). Marker only until playlist refine.",
        "builtin": "",
        "command": f'echo "ml1 air boundary :30 HST"',
        "timeout_sec": 5,
        "needs_internet": False,
        "cwd": f"{ML1}",
        "env": {},
    },
    {
        "id": "expect_radio_push_window",
        "enabled": os.environ.get("RR_ML1_AIR_MARK", "1") == "1",
        "at_minute": 55,
        "at_second": 0,
        "description": "Pacific radio_push_hour window — ML1 expects new *_current.opus (no generate here).",
        "builtin": "",
        "command": f'echo "ml1 expect Pacific radio_push :55"',
        "timeout_sec": 5,
        "needs_internet": False,
        "cwd": f"{ML1}",
        "env": {},
    },
    {
        "id": "radio_rss_poll",
        "enabled": os.environ.get("RR_RADIO_RSS", "0") == "1",
        "at_minute": 55,
        "at_second": 35,
        "description": "ML1 RadioRss poll → Database Media/RadioRss/ (same slot as Pacific job).",
        "builtin": "",
        "command": f'bash "{ML1}/scripts/run-radio-rss.sh" poll',
        "timeout_sec": 300,
        "needs_internet": True,
        "cwd": f"{ML1}",
        "env": {"RR_DATABASE_ROOT": DATABASE},
    },
    {
        "id": "radio_news_update",
        "enabled": os.environ.get("RR_RADIO_NEWS", "0") == "1",
        "at_minute": 55,
        "at_second": 40,
        "description": "News-hour speak path (same slot as Pacific). Desk fail-safe / host when gated on.",
        "builtin": "",
        "command": f'nice -n 10 python3 "{ML1}/vendor/RadioRss/scripts/rss_radio.py" news-hour --speak',
        "timeout_sec": 600,
        "needs_internet": True,
        "cwd": f"{ML1}/vendor/RadioRss",
        "env": {"RR_DATABASE_ROOT": DATABASE},
    },
    {
        "id": "youtube_stills_metadata",
        "enabled": os.environ.get("RR_ML1_YOUTUBE_META", "0") == "1",
        "at_minute": 55,
        "at_second": 50,
        "description": "Refresh YouTube live title/description (host youtube_stills.py metadata only).",
        "builtin": "",
        "command": "python3 /home/ubuntu/youtube-stills/youtube_stills.py",
        "timeout_sec": 60,
        "needs_internet": True,
        "cwd": "/home/ubuntu/youtube-stills",
        "env": {},
    },
]
