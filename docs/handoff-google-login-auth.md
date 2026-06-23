# Handoff — Single-URL Google-login for faculty

**Date:** 2026-06-23
**Status:** Not started. Durability work (below) is DONE; this is the next build.
**Why a fresh chat:** the auth/RLS change is sensitive, and a clean context lowers
the chance of mistakes. Nothing is exposed by waiting — durability is locked down.

---

## The goal (in plain terms)
Replace per-faculty login *links* with **one URL** that asks the faculty member to
"Sign in with Google," then shows them only the course(s) they've been granted.
Today each faculty gets their own tokenized link (`?t=` share-grant chain). The new
model: one link → Google sign-in → access decided by who they are, not by the link.

## What's already true (don't rebuild)
- **Google OAuth client** (Internal/ASU, full Drive scope, no verification screen):
  `190191379956-lceff4est8lvsngb50si2s5e8ejclk5m.apps.googleusercontent.com`.
  Each app origin must be in its "Authorized JavaScript origins" or you get
  `Error 400: origin_mismatch`. `course-compose.vercel.app` is already added.
- **Supabase auth.users + user_profiles** already exist and are shared by Compose
  AND Curate (project `gflnymqjraxonbdtbxma`). `user_profiles.role` ∈
  `id | system_admin | super_admin`. Site URL in Supabase auth settings must stay
  Curate's Vercel app. See memory `compose_curate_shared_supabase`.
- **Share-grant chain** (Track B/C): a blank/incomplete non-owner worksheet means
  the link is missing its `?t=` token, NOT data loss. See memory
  `instructor_blank_worksheet_rls`. This is the system the new model replaces.
- **Multi-tenant roadmap**: `docs/track-b-auth-foundation.md`; memory
  `compose_multitenant_roadmap` (Track A shipped, Track B auth design in that doc).

## Deploy facts
- Compose worksheet `course-worksheet-v2.html` + dashboard `id-dashboard.html`
  deploy to GitHub Pages AND `course-compose.vercel.app`, both from `origin/main`.
  Vercel auto-deploys within minutes of push. **Default to pushing to main**
  (memory `feedback_push_to_main`).
- Supabase admin: `supabase db query --linked` (CLI linked). DDL via `--file`,
  JSON via `--output json`. Server-side scripts need SERVICE_ROLE key, not the
  publishable key (RLS returns [] to publishable on dashboard_state/worksheets).

## Suggested approach (do it behind a flag, one step at a time)
1. **Design the grant model** — a `course_grants` table (user_id × course_id ×
   role), seeded from the current `?t=` grants so nobody loses access at cutover.
2. **Add Google sign-in to the worksheet** at one stable URL; on auth, resolve the
   user → their grants → list of courses; if exactly one, open it.
3. **RLS cutover** — switch `worksheets` row access from token-based to
   `auth.uid() ∈ course_grants`. Keep the old token path working in parallel
   behind a flag until verified, then retire it.
4. **Dashboard** — owner view to grant/revoke a faculty's access to a course
   (replaces minting per-faculty links).
- Keep each step shippable and reversible. Verify on one throwaway course before
  touching real courses.

## Durability status (DONE — context, not to-do)
Three layers live as of 2026-06-23, all in memory `worksheet_backup_durability`:
1. `worksheet_data_history` + `trg_archive_worksheet_data` — every save archives
   the prior blob (recovery).
2. `trg_protect_worksheet_shrink` — DB-level guard: a save that drops a course's
   MLOs >40% or wipes >70% of attached Drive files keeps the OLD value. Tested.
   Migration `docs/migrations/2026-06-23-worksheet-shrink-guard.sql`.
3. `scripts/backup-worksheets.mjs` + launchd `com.elisa.worksheet-backup` —
   off-database JSON snapshot of all worksheets (incl. every file link) to
   `~/course-worksheet-backups`, 3am + 3pm, keep 30.
- **Pending:** enable Supabase PITR once on Pro (the real full-DB safety floor).
- **Note:** TPH 504's pre-loss file *links* are unrecoverable (predate the net);
  objectives were fully recovered (28 MLOs, 5 ELOs, 51 tags, 0 orphans).
