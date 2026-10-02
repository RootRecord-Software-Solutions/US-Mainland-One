# var/sysmon — ephemeral only

`handoff/` — brief staging; deleted after SSH ack or Telegram accept.
`telegram-outbox/` — zip built for send; deleted after Telegram accept (never retain).
`state/` — overwrite `*-last.json` only; truncate logs; no archives.
