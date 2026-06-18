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

## ⚠ APPROACH REVISION (2026-06-18): project uses ES256 asymmetric JWTs
The project's JWKS exposes an **ES256** signing key, i.e. Supabase signs JWTs with a managed private key. So the C2 plan of minting our own **HS256** JWT from a shared `SHARE_JWT_SECRET` **will be rejected by PostgREST** — there is no usable shared secret to sign with, and we don't hold the private key. `redeem-share-token` as written + the `SHARE_JWT_SECRET` deploy step are therefore **superseded — do not deploy.**

**Revised approach — anonymous Supabase session + a grants table (no custom signing):**
1. Worksheet anon load → `supabase.auth.signInAnonymously()` → a *real* Supabase-signed session (accepted because Supabase issued it). Requires enabling Anonymous sign-ins in the dashboard (small one-time toggle).
2. Call `redeem-share-token` with `{ token, anon_uid }`; the function (service role) validates the token and inserts a row into a new `coursecompose_share_grants(anon_uid, course_id, owner_id, role)`.
3. The worksheet keeps its real anon session; RLS authorizes via a join: a row is visible when `course_id` matches a grant for `auth.uid()` (and `course_overrides` via the grant's `owner_id`). No custom JWT claims needed.
This is compatible with asymmetric signing and keeps the "existing .from() calls just work" benefit. `compose-share.js` changes from "set custom JWT" to "anon sign-in + record grant"; the dashboard token-issuing + link decoration stay as-is.

## C2 status — REBUILT (anon-session + grants), dormant (2026-06-18)

Reworked to the asymmetric-compatible approach:
- `coursecompose_share_grants` table created (anon_uid → course_id, owner_id, role).
- `redeem-share-token` edge function rewritten: reads the caller's anonymous session (Authorization → `getUser`), validates the token, records a grant. **No JWT secret / no `--no-verify-jwt` secret step.** Deploy: `supabase functions deploy redeem-share-token --no-verify-jwt`.
- `compose-share.js` `applyWorksheetToken()`: anonymous visitor → `signInAnonymously()` → `redeem()` records the grant; `_sbClient` keeps its real anon session (no client swap).
- C3 cutover migration drafted: `supabase/migrations/trackc_0003_isolation.sql` (grant-based RLS; replaces `trackb_0002`).
- Dashboard token-issuing + link decoration unchanged (still correct).

**LIVE PROGRESS 2026-06-18:**
- Edge function **deployed** (`redeem-share-token`, `--no-verify-jwt`).
- Anonymous sign-ins **enabled** in Supabase Auth.
- Shared `handle_new_user` trigger **patched to skip anonymous users** (`trackc_0004`) — without it, anon sign-in 500s on the null-email user_profiles insert. Google/Curate sign-ups unchanged.
- **End-to-end redemption verified** at the API level: anon sign-in → redeem → grant recorded; bad token → 401.
- `COMPOSE_SHARE_TOKENS_ENABLED = true` — feature ON, but **RLS is still open**, so nothing is enforced/broken: links now carry `&t=`, anon visits record a grant, and everything still loads. Revert with the flag → `false`.

**Remaining for true isolation (C3 cutover):**
- Validate a real instructor + reviewer link in a logged-out browser (worksheet loads normally; grant recorded).
- Capture the live read/write table matrix; refine `trackc_0003_isolation.sql` accordingly.
- Apply C3 in a quiet window (the breaking step). Keep `COMPOSE_SHARE_TOKENS_ENABLED=false` as the fast revert if a policy is wrong.

### Historical note — original JWT-minting variant (SUPERSEDED)
All flag-gated on `window.COMPOSE_SHARE_TOKENS_ENABLED = false`; edge function not yet deployed. Nothing live changes.
- `coursecompose_share_tokens` table created (stores raw `token`, unique per course+owner+role).
- `supabase/functions/redeem-share-token/index.ts` — token → course-scoped JWT (`course_id`, `owner_id`, `share_role`; 12h).
- `compose-share.js` — `prime()`/`tokenParam()` (dashboard mints + embeds `&t=`), `redeem()`/`applyWorksheetToken()` (worksheet swaps `_sbClient` to the scoped session).
- Dashboard link builders decorated: `copyInstructorLink`, `copyReviewerLink`, `copyDetectedReviewerLink`, `addReviewer` email, kickoff email worksheet link. Reviewers get the **reviewer** token; instructor links the **instructor** token.
- Worksheet redeems on anonymous load before any data read.
- Decision: reviewers = comments only (confirmed).

### Deploy steps (yours, when ready to test C2)
1. Set the function secret (must equal the project JWT secret so PostgREST accepts minted tokens): Supabase → Settings → API → **JWT secret**, then
   `supabase secrets set SHARE_JWT_SECRET="<that secret>"`
2. Deploy anon-callable: `supabase functions deploy redeem-share-token --no-verify-jwt`
3. Test behind the flag: load the dashboard with `?composeauth=1` won't matter here — instead set `COMPOSE_SHARE_TOKENS_ENABLED=true` in a throwaway check, copy an instructor link (it now has `&t=`), open it in a logged-out browser, confirm the worksheet loads via the scoped session. (RLS still open at this point, so this only proves redemption works.)

### Remaining before C3 cutover
- **Audit RLS for any blanket `authenticated`-allow policy** (Curate or Compose) — the minted JWT is role `authenticated` with a synthetic `sub`; course-scoped policies are the only intended grant.
- Write + apply the C3 isolation RLS (course-scoped + owner + admin; per-user `course_overrides` read via the `owner_id` claim). This replaces the on-hold `trackb_0002`.
- Confirm every worksheet-link generator carries a token (the 5 above are done).

## Open product question
- **Reviewer write scope:** confirm reviewers may post comments but **not** edit the worksheet (assumed yes — matches current reviewer = Document Preview lock).
