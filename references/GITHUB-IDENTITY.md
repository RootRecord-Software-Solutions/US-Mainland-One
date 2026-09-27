# ==============================================================================
# # INFO — MUST HAVE
# ------------------------------------------------------------------------------
# Live edits to this repo are committed as: US-MAINLAND-SERVER
# Repo: rootrecordsoftwaresolutions/US-Mainland-Server
# HOW TO ADD: after any live edit, commit + push with that author; never paste tokens.
# Host-side AWS (packer/units) may lag this mirror — note in commit body.
# ==============================================================================

Operator asked 2026-09-22: push to GitHub on each live edit, as agent identity.

## Remote hygiene (2026-09-22)
Embedded `x-access-token` PATs removed from `git remote` URLs (scrubbed to SSH or clean HTTPS).
Never commit tokens. Prefer SSH or `gh` credential helper after PAT rotate/revoke on GitHub.com.

## Profile image
Grok Bot avatar lives at `docs/avatar.png` (and `.github/profile-avatar.png`).
When Alexander spins a dedicated GitHub user for this agent, upload that file as the account avatar.
