# Track C — Share-Token Authorization (unblocks per-user isolation)

**Status:** Design + scaffolding. Nothing live changes until C3 cutover.
**Depends on:** Track B (auth live). **Unblocks:** Step 6 isolation (`trackb_0002` is on hold precisely because the anon worksheet reads ID-private tables).

## The problem (recap)
- Worksheets must stay **login-free** for faculty/reviewers (they open a link), while IDs reach them already-authenticated via the dashboard. ✔ correct model.
- But the anonymous worksheet reads ID-private tables directly — `user_courses` (`course-worksheet-v2.html:3851`, the instructor's fresh-browser course load) and `dashboard_state` `course_overrides` (`:3879`). So we can't lock those to owner-only without breaking faculty.
- Today the only thing protecting a course is an unguessable URL + wide-open RLS. That's fine for one ID; unsafe for many.

## The approach: redeem a link token → a **course-scoped** Supabase session
Don't rewrite every data call. Change only how the anon worksheet gets its *session*:

1. The ID's share link carries an opaque token: `course-worksheet-v2.html?course=X&user=<slug>&t=<token>`.
2. On load, if there's no logged-in session, the worksheet calls an edge function **`redeem-share-token`** with the token.
3. The function (service role) looks the token up, and if valid + not revoked, **mints a short-lived Supabase JWT** signed with the project JWT secret, carrying custom claims: `course_id`, `owner_id`, `share_role` (`instructor` | `reviewer`).
4. The worksheet attaches that JWT to `_sbClient` (Authorization header). Now **every existing `.from('worksheets'|'comments'|...)` call is automatically scoped** — RLS reads `auth.jwt()->>'course_id'`.
5. RLS lets a session touch only its course's rows; writes are gated by `share_role` (reviewers: comments only; instructors: worksheet edits + comments). IDs reach their own data as `owner = auth.uid()`; admins via role.

This is the cleanest fit because the worksheet keeps its current data layer — we swap the *credential*, not the calls.

## Schema (additive — see `supabase/migrations/trackc_0001_share_tokens.sql`)
`coursecompose_share_tokens(id, course_id, owner_id, role, token_hash UNIQUE, label, revoked, created_at, last_used_at)`. The raw token lives only in the link; we store its SHA-256. Owner-only RLS for direct management; the edge function uses the service role to look up by hash.

## Default decisions (chosen — veto any)
- **Granularity:** one token per **(course, role)**. Instructor and reviewer links differ → per-role revocation + per-role write scope. (Individual reviewers are still distinguished by the existing `&user=<slug>` for comment attribution; the token authorizes, the slug labels.)
- **Lifetime:** token = long-lived + **revocable** (no hard expiry); the *minted JWT* is short (e.g. 12h), silently re-redeemed from the still-valid link token. Faculty links survive a whole course build but you can kill access instantly.
- **Storage:** store **hash** only; raw token is unrecoverable (re-issue if lost).
- **Existing links:** at C3 cutover, old token-less links stop working. Mitigation: the dashboard's "Copy Instructor Link / reviewer link" buttons start emitting `&t=` tokens in **C2**, so re-sent links are future-proof; document that pre-cutover links must be re-copied.

## Phases (each safe; nothing breaks until C3)
- **C1 — scaffolding (now):** design + token table migration (not yet run). No behavior change.
- **C2 — issue tokens (flag-gated):** dashboard mints/stores a token and appends `&t=` to the instructor/reviewer links it copies; worksheet *optionally* redeems it but still works without (RLS still open). Build + deploy `redeem-share-token` edge function (unused until enabled). Test end-to-end behind a flag.
- **C3 — cutover (quiet window):** flip enforcement; apply the redesigned isolation RLS (course-scoped + owner + admin) on `worksheets`, `user_courses`, `comments`, `worksheet_sessions(_events)`, and the `course_overrides` read; run the deferred per-user lockdown on `dashboard_state`/`user_courses` private data. This is the real Step 6 — now safe because faculty go through the scoped token.

## RLS sketch (C3)
- `worksheets`, `comments`, `worksheet_sessions`: `using (owner_id = auth.uid() OR course_id = auth.jwt()->>'course_id' OR <admin>)`; writes additionally check `share_role` (reviewer = no worksheet writes).
- `user_courses`: same course-scoped read; write owner/admin only.
- `dashboard_state`: private keys owner/admin only; `course_overrides` readable when `user_id = (auth.jwt()->>'owner_id')::uuid` (owner id travels in the claim, so the worksheet fetches the owner's overrides without seeing other IDs').

## Open product question
- **Reviewer write scope:** confirm reviewers may post comments but **not** edit the worksheet (assumed yes — matches current reviewer = Document Preview lock).
