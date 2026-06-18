# Track C (part 2) — New-ID Onboarding & Per-User Integrations

**Goal:** let a brand-new ID self-serve the setup that was painful for Elisa —
connecting Jira, Airtable, Granola, Google Calendar, Canvas — via a guided
first-run wizard, including building their contacts directory from Granola
transcripts. This is the "setup load" concern from the very start of the project.

## The hard dependency (must be solved first)
Today every integration secret lives in **Elisa's local `~/.env` + `sync-server.js`
running on her laptop** (Jira/Granola/CreateAI keys; the calendar is a hardcoded
ICS URL). A new ID has none of that and no laptop daemon. So a wizard alone is
hollow — onboarding requires moving secrets + sync **server-side, per user**:

1. **Per-user credential vault** — an encrypted, RLS-owner-only store of each
   user's tokens. (Canvas already has `user_canvas_credentials` as a model.)
2. **Hosted per-user sync** — the work `sync-server.js` does on Elisa's laptop
   must run server-side for everyone: Supabase Edge Functions on a cron, or the
   FastAPI backend / a Railway worker, reading each user's vault creds.

Without these, "Connect Jira" has nowhere to store the token and nothing to run
the sync. So the wizard UI (O1) is safe to build first, but real value needs O2+.

## Per-integration onboarding
| Integration | Credential the user provides | How obtained | Sync to move server-side |
|---|---|---|---|
| Jira | email + API token + base URL | id.atlassian.com → API tokens | `scripts/sync-jira-time.mjs` (nightly worklog) + proxy reads |
| Airtable | PAT (scoped) | airtable.com/create/tokens | `scripts/sync-airtable-courses.mjs` (already partly via edge fn) |
| Granola | API key | Granola app | `scripts/sync-granola.mjs` → meetings table |
| Google Calendar | per-user ICS URL or OAuth | Outlook/Google | `sync-calendar.js` (currently hardcoded ICS) |
| Canvas | PAT (weekly) | Canvas account | already has `user_canvas_credentials` + backend |

## Granola → contacts directory
On first Granola sync, analyze the new user's transcripts to extract recurring
people (faculty, staff) and seed their `faculty_directory` / contacts — the
implicit "learns-from-saves" directory the dashboard already has, but bootstrapped
from real meeting history instead of empty.

## Phased plan
- **O1 — First-run wizard UI (safe, buildable now).** Detect a new/empty account
  (no courses, no synced data) and show a welcome + step checklist ("Connect Jira",
  "Connect Airtable", …) with status ticks. Dormant for existing users (Elisa has
  data). Pure UI + a `onboarding_state` flag; no secrets yet.
- **O2 — Credential vault + one vertical slice.** Encrypted per-user creds table
  (RLS owner-only); a "Connect <X>" flow that validates + stores a token. Do ONE
  integration end-to-end first as the pattern (recommend **Jira** — Elisa's
  biggest pain, and read-mostly).
- **O3 — Hosted per-user sync.** Move that integration's sync server-side (Edge
  Function on a schedule / backend job) reading the vault. Then replicate for the
  rest. Retire the laptop `sync-server.js` per integration.
- **O4 — Granola → contacts** analysis on first sync.

## Decisions needed before O2
1. **Where does hosted sync run?** Supabase Edge Functions on cron (lightest;
   matches existing edge-fn pattern) vs the FastAPI backend / Railway worker
   (already exists for Curate; better for heavier jobs). *Recommend: Edge
   Functions + Supabase scheduled triggers for these light syncs.*
2. **Credential encryption:** Supabase Vault / pgsodium vs app-level encryption
   in the backend (the Canvas creds model). *Recommend: match whatever
   `user_canvas_credentials` already does for consistency.*
3. **First integration to slice (O2/O3):** Jira / Airtable / Granola / Calendar?

## Recommended start
Build **O1 (wizard UI)** now — safe, visible, no backend needed — then do the
**O2+O3 vertical slice for one integration** so we prove the vault+hosted-sync
pattern before fanning out to the rest.
