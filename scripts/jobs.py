# ==============================================================================
# # INFO — MUST HAVE (future agents / operators)
# ------------------------------------------------------------------------------
# This desk is the US-Mainland-Server git work tree.
# OmniBook pushes via Pacific poller github_sync_all (every 300s).
# AWS pulls only (every 60s) — never rclone bisync.
# Intake data → /home/rootrecord/Database/intake/
# Baks → /home/rootrecord/Database/GITHUB/  (never under skills/)
# Pacific .gitignore excludes us-mainland-server/ from Solar-Pacific repo.
# ==============================================================================
#
# HOW TO ADD A JOB (no AI required)
#   1) Copy the blank TEMPLATE from the matching section.
#   2) Paste inside that list (keep commas).
#   3) Set enabled=True; fill labeled fields.
#   4) Keep the same key order / quoting.
#   5) OmniBook: restart rootserver-poller if wiring into automations.
#      AWS: install references/aws-git-pull.* for the 1-minute pull.
#
# NOTE: This jobs.py is the offline-edit contract for THIS repo.
#       The live OmniBook scheduler still lives in automations/scripts/jobs.py
#       (github_sync_all). AWS pull is systemd on the mainland host.
# ==============================================================================

DEFAULTS = {
    "enabled": False,
    "timeout_sec": 120,
    "cwd": "",
    "env": {},
}

# ==============================================================================
# SECTION: ON_BOOT  (document / local helpers — lower priority runs first)
# ==============================================================================
ON_BOOT = [
    {
        "id": "self_desk",
        "enabled": True,
        "priority": 0,
        "description": "Registry: this folder is the US-Mainland-Server work tree.",
        "builtin": "",
        "command": "printf 'us-mainland-server desk @ %s\\n' \"$(pwd)\" && git rev-parse --short HEAD && git remote -v | sed -E 's#(x-access-token:)[^@]+@#\\1***@#g' | head -4",
        "timeout_sec": 15,
        "cwd": "/home/rootrecord/.ollama/skills/us-mainland-server",
        "env": {},
    },
    # --- TEMPLATE (on boot) — copy from here -----------------------------------
    # {
    #     "id": "example_on_boot",
    #     "enabled": False,
    #     "priority": 2,
    #     "description": "One-line plain description.",
    #     "builtin": "",
    #     "command": "/home/rootrecord/.ollama/skills/us-mainland-server/scripts/example.sh",
    #     "timeout_sec": 120,
    #     "cwd": "/home/rootrecord/.ollama/skills/us-mainland-server",
    #     "env": {},
    # },
    # --- end TEMPLATE ----------------------------------------------------------
]

# ==============================================================================
# SECTION: ONCE_AT_START
# ==============================================================================
ONCE_AT_START = [
    # --- TEMPLATE (once) — copy from here --------------------------------------
    # {
    #     "id": "example_once",
    #     "enabled": False,
    #     "description": "One-line plain description.",
    #     "builtin": "",
    #     "command": "",
    #     "timeout_sec": 300,
    #     "cwd": "/home/rootrecord/.ollama/skills/us-mainland-server",
    #     "env": {},
    # },
    # --- end TEMPLATE ----------------------------------------------------------
]

# ==============================================================================
# SECTION: EVERY_SECONDS
# ==============================================================================
EVERY_SECONDS = [
    # --- TEMPLATE (every X seconds) — copy from here ---------------------------
    {
        "id": "aws_git_pull_doc",
        "enabled": True,
        "description": "DOC ONLY — on AWS install aws-git-pull.timer (every 1 min pull --ff-only).",
        "only_at_minutes": [],
        "builtin": "",
        "command": "git pull --ff-only",
        "timeout_sec": 60,
        "cwd": "/home/ubuntu/US-Mainland-Server",
        "env": {},
    },
    # --- TEMPLATE (every minute) — copy from here ------------------------------
    # --- end TEMPLATE ----------------------------------------------------------
]

# ==============================================================================
# SECTION: EVERY_MINUTE
# AWS host: git pull --ff-only every minute (see references/aws-git-pull.timer).
# OmniBook does NOT pull here — it only pushes via automations github_sync_all.
# ==============================================================================
EVERY_MINUTE = [
    {
        "id": "aws_git_pull_doc",
        "enabled": True,
        "description": "DOC ONLY — on AWS install aws-git-pull.timer (every 1 min pull --ff-only).",
        "only_at_minutes": [],
        "builtin": "",
        "command": "git pull --ff-only",
        "timeout_sec": 60,
        "cwd": "/home/ubuntu/US-Mainland-Server",
        "env": {},
    },
    # --- TEMPLATE (every minute) — copy from here ------------------------------
    # {
    #     "id": "example_every_minute",
    #     "enabled": False,
    #     "description": "One-line plain description.",
    #     "only_at_minutes": [],
    #     "builtin": "",
    #     "command": "",
    #     "timeout_sec": 120,
    #     "cwd": "/home/rootrecord/.ollama/skills/us-mainland-server",
    #     "env": {},
    # },
    # --- end TEMPLATE ----------------------------------------------------------
]

# ==============================================================================
# SECTION: EVERY_HOUR
# ==============================================================================
EVERY_HOUR = [
    # --- TEMPLATE (every hour) — copy from here --------------------------------
    # {
    #     "id": "example_every_hour",
    #     "enabled": False,
    #     "description": "One-line plain description.",
    #     "only_at_hours": [],
    #     "builtin": "",
    #     "command": "",
    #     "timeout_sec": 300,
    #     "cwd": "/home/rootrecord/.ollama/skills/us-mainland-server",
    #     "env": {},
    # },
    # --- end TEMPLATE ----------------------------------------------------------
]

# ==============================================================================
# FULL BLANK TEMPLATE (all keys labeled)
# ------------------------------------------------------------------------------
# {
#     "id": "unique_snake_case_name",
#     "enabled": False,
#     "priority": 2,
#     "description": "Plain words: what / why.",
#     "interval_sec": 60,
#     "only_at_minutes": [],
#     "only_at_hours": [],
#     "builtin": "",
#     "command": "/path/to/script.sh",
#     "timeout_sec": 120,
#     "cwd": "/home/rootrecord/.ollama/skills/us-mainland-server",
#     "env": {},
# },
# ==============================================================================
