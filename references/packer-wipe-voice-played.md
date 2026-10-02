# Packer wipe completeness (AWS host 2026-09-22)

After successful datapack send, `wipe_work()` now also:
- deletes `radio/voice-played/*Current*`
- truncates `logs/*.log` (keeps files for unit append)

Bak on host: `~/rootrecord/bin.bak-wipe-voice-20260922-173915/`
Never delete `hawaii-offset.json` or `radio/media/` beds.
