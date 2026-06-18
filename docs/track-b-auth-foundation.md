# Track B — Auth Foundation for Multi-User Compose

**Status:** Design / not yet built
**Owner:** Elisa Penmar
**Goal:** Turn Compose from a single-hardcoded-user tool into a multi-tenant product where each Instructional Designer (ID) has their own isolated account, while keeping the faculty/reviewer share-link flow working.

> Track B is the **gate** for everything else in the multi-user roadmap (admin hub, in-app feedback triage, AI-populated college pages, the onboarding wizard). None of those are safe to build until identity + data isolation exist. Track B deliberately does **not** include hosted per-user integration sync or the credential vault — that's Track C.

---

## 1. What Track B is (and isn't)

**In scope**
- Real authentication on the **dashboard** (`id-dashboard.html`) via Supabase Auth + Google OAuth, restricted to `@asu.edu`.
- A `profiles` table that replaces the hardcoded `defaultProfile` (name, email, asurite, booking link, signature).
- **Per-ID isolation of ID-private data**: each ID sees only their own dashboard state, courses, resource links, faculty directory, reviewer map.
- An `admins` concept so Elisa can read another ID's data for troubleshooting (foundation for Track D's admin hub).
- A one-time backfill that assigns all existing data to Elisa's account.

**Explicitly out of scope (later tracks)**
- Hardening worksheet/comment writes for unauthenticated faculty/reviewers via signed share tokens → **Track C**.
- Moving integration sync (Jira/Granola/Airtable/calendar) off Elisa's laptop and into hosted per-user jobs + a credential vault → **Track C**.
- Admin hub UI, feedback pipeline, AI-populated pages, onboarding wizard → **Track D** (built on B's identity layer).

---

## 2. Current state (grounded in the code)

| Piece | Today | File |
|---|---|---|
| Dashboard | Static HTML on GitHub Pages, **no login**, identity hardcoded | `id-dashboard.html:7372` (`defaultProfile`) |
| Worksheet | Static HTML, used by ID **and** faculty/reviewers via `?user=<slug>` links — **must stay anon** | `course-worksheet-v2.html` |
| Supabase client | Publishable (anon) key, no auth session | `supabase-config.js` |
| Tables | `worksheets`, `dashboard_state`, `comments`, `user_courses`, `worksheet_sessions`, `worksheet_session_events` | `supabase-schema.sql` |
| RLS | Enabled but **wide open**: `using (true) with check (true)` on every table | `supabase-schema.sql:109-127` |
| Sync to cloud | Browser writes directly with the anon key (push/pull) | `supabase-sync.js` |
| Integration secrets | In `/Users/epenmar/conductor/.env` + `sync-server.js` on Elisa's laptop | (single-user by design) |

**The two access patterns that drive the whole design:**
- **Dashboard = an ID-only app.** Only logged-in IDs ever use it. Safe to put fully behind login.
- **Worksheet = a shared app.** IDs, instructors, and reviewers all open it, and the latter two are **not** logged in (magic `?user=` links). It must keep working anonymously.

This split is the key simplification: **Track B authenticates the dashboard and isolates ID-private tables; the worksheet/sharing path is left on the current permissive model and hardened in Track C.**

---

## 3. The precedent to copy: CanvasCurate

Per `canvascurate/CLAUDE.md`, the sibling product already runs the target pattern in production:

- **Auth:** Supabase (Google OAuth), JWT validated server-side via supabase-py (`canvascurate/backend/auth.py` → `get_current_user()` returns `{sub, email}`).
- **Every user-owned table has `user_id uuid references auth.users(id)`.**
- **RLS enabled on all tables.** Backend uses the **service role key** (bypasses RLS); frontend uses the **user JWT** (subject to RLS).
- Rule: *all DB writes go through the Python backend; never write tables directly from the browser.*

**What we copy:** Google OAuth, `user_id` columns, RLS-per-user, the `admins` idea, `@asu.edu` restriction.

**Where Compose must diverge (for now):** Compose's dashboard has **no always-on backend** — only `sync-server.js` on Elisa's laptop. So in Track B the dashboard keeps writing Supabase **directly from the browser**, but with the **authenticated user's JWT** instead of the anon key. RLS then enforces ownership. We converge on Curate's "writes-through-backend" rule in Track C when hosted sync lands.

> **Strategic decision to make (see §9):** does Compose authenticate against its **own** Supabase project (`gflnymqjraxonbdtbxma`), or do we consolidate Compose + Curate onto **one** project so an ID has a single login across both tools? Recommended: unify eventually, but Track B can ship on the existing Compose project to avoid blocking.

---

## 4. Data model changes

### 4.1 ID-private tables → hard isolation

These are only ever touched by the owning ID. Add ownership and lock RLS.

```sql
-- profiles: replaces the hardcoded defaultProfile
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text,
  asurite text,
  booking_url text,
  signature text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);
alter table profiles enable row level security;
create policy "own profile" on profiles for all
  using (id = auth.uid()) with check (id = auth.uid());

-- admins helper (could also be a column on profiles; keeping a function is convenient for RLS)
create or replace function is_admin() returns boolean language sql stable as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false);
$$;

-- dashboard_state: PK becomes (user_id, key)
alter table dashboard_state add column if not exists user_id uuid references auth.users(id);
-- after backfill (see §6): drop old PK, add composite PK
-- alter table dashboard_state drop constraint dashboard_state_pkey;
-- alter table dashboard_state add primary key (user_id, key);

-- user_courses: add owner, disambiguate course_id collisions across IDs
alter table user_courses add column if not exists user_id uuid references auth.users(id);
-- recommend: surrogate id + unique(user_id, course_id) so two IDs can both have "TPH550"
```

RLS for ID-private tables (the pattern, applied to `dashboard_state`, `user_courses`, `profiles`):

```sql
drop policy if exists "open access" on dashboard_state;
create policy "own or admin" on dashboard_state for all
  using (user_id = auth.uid() or is_admin())
  with check (user_id = auth.uid() or is_admin());
```

The `or is_admin()` clause is what lets Elisa troubleshoot another ID's dashboard (Track D foundation).

### 4.2 Shared tables → record ownership, keep permissive (for now)

`worksheets`, `comments`, `worksheet_sessions`, `worksheet_session_events` are written by anonymous faculty/reviewers, so they **cannot** require auth in Track B.

```sql
alter table worksheets add column if not exists owner_id uuid references auth.users(id);
alter table comments  add column if not exists owner_id uuid references auth.users(id);
```

- Add `owner_id` so the dashboard can list "my courses" and so admins/future code can scope.
- **Leave RLS effectively permissive** on these (security via unguessable course IDs / slugs, exactly as today).
- **Course-ID collision:** worksheets are keyed by `course_id` (e.g. `TPH550`). Two IDs developing the same code would collide. Track B must move worksheets to a surrogate `id` with `unique(owner_id, course_id)`, and share links must reference that surrogate id. **This touches `course-worksheet-v2.html` and the `?course=`/`?user=` link format — call it out as its own sub-task.**

> Hardening these tables (per-link signed tokens, edge-function-mediated writes) is **Track C**. Documented gap, not a Track B blocker.

---

## 5. Auth flow on the static dashboard

`id-dashboard.html` already loads the Supabase JS client and Google Identity Services. Add:

1. **On load:** `const { data:{ session } } = await supabase.auth.getSession();`
   - If `session` → continue boot; use `session.user` to load/create the `profiles` row; the supabase-js client now auto-attaches the user's access token to every table call, so reads/writes become user-scoped automatically.
   - If no `session` → render a **login gate overlay** (block the dashboard) with a single "Sign in with ASU Google" button.
2. **Sign-in:**
   ```js
   supabase.auth.signInWithOAuth({
     provider: 'google',
     options: { queryParams: { hd: 'asu.edu' }, redirectTo: window.location.href }
   });
   ```
3. **Redirect handling:** supabase-js `detectSessionInUrl` consumes the OAuth callback automatically.
4. **`@asu.edu` enforcement:** `hd` is only a client hint. Enforce server-side — simplest is an RLS/profile-creation check on `auth.jwt() ->> 'email' like '%@asu.edu'`, or a Supabase auth hook that rejects non-ASU domains.
5. **Logout + user switch:** add a logout control; on logout, `supabase.auth.signOut()` and **clear the localStorage cache** (today localStorage is global per browser — namespace the cache by `user.id`, or wipe it on logout, so a shared machine never leaks one ID's cached data to another).

**The worksheet stays anonymous.** `course-worksheet-v2.html` keeps using the publishable key. The login gate is applied to `id-dashboard.html` only.

---

## 6. Migrating existing (Elisa's) data

1. Elisa signs in once with Google → capture her `auth.users.id` (`select id, email from auth.users;`).
2. One-time backfill (SQL editor or linked CLI against `gflnymqjraxonbdtbxma`):
   ```sql
   update dashboard_state set user_id = '<elisa-uid>' where user_id is null;
   update user_courses   set user_id = '<elisa-uid>' where user_id is null;
   update worksheets     set owner_id = '<elisa-uid>' where owner_id is null;
   update comments       set owner_id = '<elisa-uid>' where owner_id is null; -- or by author
   insert into profiles (id, email, name, asurite, booking_url, signature, is_admin)
     values ('<elisa-uid>', 'elisa.penmar@asu.edu', 'Elisa Penmar', 'epenmar', '<booking>', 'Elisa', true);
   ```
3. Only **after** backfill, tighten PKs/constraints and swap RLS policies from `open access` → `own or admin`. Do this in one migration so there's never a window where Elisa's own data is locked out.

---

## 7. Phasing within Track B

| Phase | Deliverable | Risk |
|---|---|---|
| **B1** | Stand up Supabase Auth (Google, `@asu.edu`); add login gate + logout to the dashboard; `profiles` table; derive identity from session instead of `defaultProfile`. Ship behind a flag so current usage isn't broken. | Low |
| **B2** | Schema migration: add `user_id`/`owner_id`, `admins`/`is_admin`, surrogate id for `user_courses`/`worksheets`; backfill Elisa's rows. | Medium (collision/PK changes) |
| **B3** | Swap RLS on ID-private tables to `own or admin`; update `supabase-sync.js` to read/write under the user JWT and filter by `user_id`. | Medium |
| **B4** | Namespace localStorage cache by `user.id`; clean logout/user-switch. | Low |
| **Deferred → C** | Worksheet/comment share-token hardening; hosted per-user integration sync + credential vault. | — |

---

## 8. Risks & mitigations

- **Breaking the faculty/reviewer flow** — mitigated by leaving the worksheet anon and shared tables permissive in B.
- **Course-ID collisions across IDs** — mitigated by surrogate id + `unique(owner_id, course_id)`; requires touching the worksheet link format (own sub-task in B2).
- **Sync scripts** (`sync-server.js`, `sync-granola.mjs`, nightly Jira cron) write with the anon key as Elisa — in B they should use the **service role key** (server-side only) so they keep working after RLS tightens. They stay single-user until Track C.
- **Locking yourself out** — never tighten RLS before the backfill (§6 ordering).
- **Shared-machine cache leakage** — fixed in B4.

---

## 8b. Decisions locked (2026-06-18)

- **Defer the Curate connection.** The **Canvas Plan** view in the worksheet (the CourseCompose→CanvasCurate bridge) is gated: signed-in **non-admin** IDs see a greyed nav item + a "coming soon" panel; the owner/admin keeps full access. Implemented via `ComposeAuth.ownerToolsBlocked()`; no-op while auth is off.
- **Self-registration:** any `@asu.edu` Google account may sign in (no invite/allow-list). Domain is the only restriction.
- **One project for now:** ship B on the existing Compose project (`gflnymqjraxonbdtbxma`); Compose↔Curate account consolidation stays deferred.

## 8c. B1 status — built, dormant, on branch `ID-Dashboard-v1` (NOT pushed)

Because the live dashboard/worksheet are in active daily use, B1 is staged so it is **completely inert** until explicitly enabled:

- `compose-auth.js` — auth client (login gate, profile load/create, `isAdmin()`, `ownerToolsBlocked()`). Reuses the existing `window._sbClient`.
- `supabase-config.js` — `window.COMPOSE_AUTH_ENABLED = false` (master switch) + `COMPOSE_ADMIN_EMAILS` bootstrap list.
- Dashboard boot calls `ComposeAuth.init({requireLogin:true})`; worksheet boot calls `ComposeAuth.init()` (no gate — stays anon). Both no-op while the flag is false.
- Canvas Plan "coming soon" gate wired (`renderCanvasPlan` + `_applyIdToolsVisibility`).
- `supabase/migrations/trackb_0001_additive.sql` (safe anytime) and `trackb_0002_isolation.sql` (breaking — run only during a quiet window).

Nothing is pushed to `main`, so the live tool is unaffected until we deliberately deploy + flip the flag.

### Go-live checklist (do during a quiet window, not mid-session)
1. **Supabase:** Authentication → Providers → enable **Google**; add a Google Cloud OAuth client (Authorized redirect URI = `https://gflnymqjraxonbdtbxma.supabase.co/auth/v1/callback`); set the dashboard URL as an allowed redirect.
2. **Restrict to ASU:** add an auth hook / policy rejecting non-`@asu.edu` emails (client `hd` param is only a hint).
3. Run `trackb_0001_additive.sql`.
4. Push the branch to `main`, hard-refresh, confirm the dashboard still works with the flag **off**.
5. Flip `COMPOSE_AUTH_ENABLED = true`, push, sign in as Elisa, confirm login + Canvas Plan still available to you.
6. Get Elisa's `auth.users.id`; fill `<ELISA_UID>` in `trackb_0002_isolation.sql`; run it.
7. Verify isolation with a second ASU account (sees own empty dashboard; Canvas Plan greyed/"coming soon").

## 8d. REALITY CHECK (2026-06-18): Compose & Curate share ONE Supabase project

Discovered while configuring auth (the project's Site URL was Curate's Vercel app). `gflnymqjraxonbdtbxma` hosts **both** products. Implications baked into the build:

- **Accounts are already unified.** One `auth.users`; one `user_profiles` table (`id, email, full_name, role, is_active, auth_provider`). The `role` enum is **`id | system_admin | super_admin`**. A trigger `handle_new_user` auto-creates the `user_profiles` row on first sign-in → **any ASU account self-registers automatically** (matches the decision).
- **No separate `profiles` table** — `compose-auth.js` reads `user_profiles`; admin = `role in (system_admin, super_admin)` OR email in `COMPOSE_ADMIN_EMAILS`. (Your account is currently role `id`, so the email allow-list is what makes you admin for Compose owner-tools like Canvas Plan, without changing your Curate role.)
- **Owner UID is known:** `epenmar@asu.edu` = `30bb2d7b-000b-440f-87dc-c8d7af826d39` (baked into `trackb_0002_isolation.sql`).
- **Shared-DB safety:** the additive migration only touches Compose-owned tables (`dashboard_state`, `user_courses`, `worksheets`, `comments`) and creates no shared objects, so it can't affect Curate. RLS tightening in step 2 is likewise scoped to Compose's ID-private tables.
- **Auth config is shared too:** the Supabase **Site URL must stay `https://canvascurate-v2.vercel.app`** (Curate depends on it). Compose works via `redirectTo: window.location.href` + having the dashboard URL in the **Redirect URLs allow-list**. The Google OAuth client was swapped to the new "Compose Web" client (same Google project as Drive); verify Curate login still works after, since it now flows through that client.

## 9. Open questions for Elisa

1. ~~One Supabase project or two?~~ **RESOLVED:** already one shared project with Curate (see §8d) — accounts are unified, nothing to consolidate.
2. **Who can self-register?** Any `@asu.edu` Google account, or an invite/allow-list you control? *(Affects the auth hook in B1 and ties into the admin hub.)*
3. **Comment authorship across IDs** — when backfilling `comments.owner_id`, attribute by course owner, or leave as-is keyed by `author_name/role`?

---

## 10. What this unblocks

Once B exists:
- **Track C** — onboarding wizard + hosted per-user integration sync + credential vault (solves the setup-load pain; includes Granola-transcript → contacts directory).
- **Track D** — admin hub (account list, impersonate-to-troubleshoot via `is_admin()`), in-app Report Issue → a page you + Claude triage, AI-populated college/home/faculty/catalog pages seeded from each user's Airtable sync.
