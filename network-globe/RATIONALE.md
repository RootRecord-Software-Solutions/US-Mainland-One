# Rationale — this revival of the collector

Companion to `Claude_Current_Understanding.md` (the fuller project
checkpoint). This file is scoped to just this folder's changes, for
whoever picks this up next.

## What this is

A revival of `local-data-globe/collector.js` from the
`online-safe-20260920` pre-reset backup — the most advanced of three prior
collector versions found, the only one that already used
`ssh.rootrecord.cloud` + a Cloudflare Access `ProxyCommand` instead of a
raw AWS IP.

## What changed from that version, and why

1. **Removed the on-disk `outbox.ndjson` buffer and its replay-on-reconnect
   logic.** The prior version treated a lost SSH connection as "queue it,
   send it later." That's a store-and-forward design. The actual
   requirement (confirmed explicitly): AWS is a **live mirror** of the
   network, not a data store — it should never receive a delayed dump of
   what it missed, and a connectivity gap should visibly show as a gap on
   the globe, not get silently patched over later. So that mechanism was
   removed rather than tuned.

2. **Added `telegram-relay.js`.** Not a replacement for the removed
   buffer — a genuinely different thing. It's off-box insurance for human
   reference, using the channel that was already in use
   ("Root Record Data Relay", zip-per-batch, same filename convention).
   Explicitly never routes back into AWS. In-memory only, no disk
   persistence — an accepted loss if the process dies mid-batch, not an
   oversight.

3. **Left the SSH/Cloudflare path as found.** It already matched what was
   asked for (hostname-based, dynamic-IP-proof). Verified it parses and
   is internally consistent; have not verified it actually connects,
   since that requires the real `cloudflared` binary, a real key, and a
   real box — none of which exist in this sandbox.

## What is still explicitly unverified / not done

- **Not tested against a real AWS host.** No way to verify the SSH pipe,
  the `__NETWORK_GLOBE_SSH_READY__` handshake, or the Telegram send path
  actually work end-to-end from this environment. Needs a real run on the
  local box.
- **`TELEGRAM_RELAY_CHAT_ID` is unset.** Needs the actual chat id for the
  existing "Root Record Data Relay" channel — I don't have it. The bot
  token loads the same way `coms/telegram` already does
  (`master-key.env`), so that part should just work once the token file
  exists on the box, but the chat id is still a manual fill-in.
- **AWS-side breakage is untouched.** Per the understanding doc, this was
  explicitly scoped out of the local collector work. Still don't know why
  uploads stopped on AWS's side.
- **`coms/ssh/SKILL.md` has not been updated.** It still describes a
  pull/rsync/wipe model that doesn't match this code. Should be rewritten
  to describe what's actually here before this is considered done —
  flagging rather than doing it now, since it touches a file outside this
  folder and is worth a deliberate look rather than a drive-by edit.
- **Final home for this folder is unresolved** — `local-data-globe/` as
  its own skill (matching where it lived before), or folded into
  `coms/ssh`? Noted in the README as an open question, not decided here.
