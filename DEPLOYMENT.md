# Deployment Guide

This document is a checklist for the future, real deployment of Ovi Mobile.
**The app has not been deployed to Vercel yet.** As of Phase 29, the
database has moved from local SQLite to online PostgreSQL (Supabase
preferred). As of Phase 30, the codebase and this checklist are prepared
for a clean Vercel deployment (build script, environment variables,
database/pooler recommendation, Google OAuth redirect, known upload
limitation) — but the actual Vercel import/deploy itself has not happened
yet. A real migration history and cloud media storage remain separate,
later phases.

## Database: PostgreSQL (Supabase preferred)

**This project now uses PostgreSQL** (`prisma/schema.prisma` declares
`provider = "postgresql"`) — there is no local SQLite fallback anymore.
[Supabase](https://supabase.com) is the preferred provider for now; Prisma
Postgres on Vercel is an acceptable alternative. [Neon](https://neon.tech)
and [Railway](https://railway.app) remain viable if requirements change
later.

Local development and any deployed environment both point at the same kind
of database now — the only difference is which `DATABASE_URL`/`DIRECT_URL`
each environment uses. Local values go in `.env` (gitignored, never
committed); a deployed environment's values are set directly in that host's
dashboard (e.g. Vercel's Environment Variables settings) — never committed
either.

## PostgreSQL readiness (Phase 29 — done) and what's still pending

The schema (`prisma/schema.prisma`) was written from Phase 1 to make this
switch low-risk, and that groundwork is why the Phase 29 cutover required no
model changes:

- **Int money fields**, not `Decimal`/`Float` — pricing/cost fields are
  integer cents, avoiding floating-point rounding, unaffected by the
  database move.
- **String-based statuses**, not native Prisma `enum` — kept from the
  SQLite era. Every status/role/type field is a `String` constrained by
  `src/lib/constants.ts`. These can optionally be promoted to real `enum`
  columns now that PostgreSQL is in use, as a separate follow-up, without
  touching application code.
- **`cuid()` string ids** everywhere — no autoincrement sequence behavior
  to reconcile.

**Done in Phase 29:**
- `prisma/schema.prisma` datasource is `provider = "postgresql"`, with
  `url = env("DATABASE_URL")` and `directUrl = env("DIRECT_URL")`.
- Six `contains:` search filters across the app (public product search,
  admin orders/merchants/inventory-movements search, rep sale lookup) now
  set `mode: "insensitive"` — required because PostgreSQL's `LIKE` (what
  Prisma's `contains` compiles to) is case-sensitive by default, unlike
  SQLite's. Without this, existing case-insensitive search UX would have
  silently regressed.

**What has NOT happened yet, and must not happen without separate
approval:**
- **No migration history exists.** This project still only uses
  `npx prisma db push`, which has no concept of a migration history — it
  just reconciles the live schema. This is acceptable for the current
  prototype/demo stage, but production must not do this. Before the first
  real production deploy:
  1. Run `npx prisma migrate dev --name init` locally against the
     PostgreSQL database to generate the first migration file.
  2. Commit `prisma/migrations/`.
  3. In production, run `npx prisma migrate deploy` (never `db push`,
     never `migrate dev`) to apply migrations.

## Vercel deployment checklist (Phase 30 — preparation only, not deployed yet)

**Nothing in this section has been executed.** The app is prepared to
deploy cleanly, but the actual Vercel import/deploy is a deliberate,
separate step, not a side effect of this preparation phase.

### A) Before Vercel

- [x] Online PostgreSQL database already provisioned (Supabase) — Phase 29
- [x] Prisma schema already pushed to it manually (`npx prisma db push`) —
      Phase 29
- [x] Demo/admin data already seeded manually (`npm run db:seed`) —
      Phase 29
- [x] `main` is up to date on GitHub:
      https://github.com/Nimer-Asaad/Ovi-Mobile

### B) Vercel project setup

- [ ] Import the repository into Vercel
- [ ] Add the environment variables (see the table below) in the Vercel
      project settings **before** the first deploy
- [ ] Build command: Vercel auto-detects Next.js and runs the `build`
      script from `package.json`, which is now:
      ```
      prisma generate && next build
      ```
      No `vercel.json` override needed — this project doesn't have one and
      doesn't need one. Running `prisma generate` explicitly in the build
      script (rather than relying solely on the `postinstall` hook) avoids
      an edge case where a cached `npm install` between deployments could
      skip regenerating the Prisma Client after a schema change — cheap
      (no live DB connection required, confirmed in Phase 29) and now
      unconditional.
- [ ] Trigger the first deploy and watch the build log for Prisma or
      TypeScript errors

### C) Database connection strings for Vercel

**Update (Phase 31): the session-pooler choice below was reverted.** After
the first real Vercel deploy, the app hit this **runtime** error on
ordinary page requests (not during the build):

```
PrismaClientInitializationError
EMAXCONNSESSION
max clients reached in session mode
pool_size: 15
```

This is the standard failure mode of pairing a serverless platform with a
session-mode pooler: Supabase's session pooler holds each connection open
for the lifetime of the client, and every concurrent Vercel serverless
invocation opens its own Prisma connection pool against the same small
slot ceiling (15, per the error above). Under any real concurrent traffic
those slots exhaust quickly. The Phase 29 rationale for session pooler
(below, kept for history) was about a *build-time* concurrent-query burst,
not runtime traffic — the fix is to use different poolers for the two
situations instead of the same one for both:

- [ ] **`DATABASE_URL` (runtime queries) = Supabase transaction pooler,
      port 6543, with `?pgbouncer=true&connection_limit=1`.** This is the
      standard Prisma-on-serverless recommendation: transaction mode
      returns each connection to the pool as soon as a query finishes
      (instead of holding it for the client's lifetime), so many
      concurrent serverless invocations can share Supabase's pooler
      without exhausting it. `connection_limit=1` caps each Prisma
      Client's own internal pool to one connection — correct for a
      serverless function, which handles requests one at a time per
      invocation anyway, and avoids one lambda instance alone opening
      several connections.

  Example shape only — do not use real credentials here or anywhere in
  this file:
  ```
  DATABASE_URL="postgresql://<user>:<password>@<host>.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1"
  ```

- [ ] `DIRECT_URL` = **unchanged, still the session/direct pooler, port
      5432** — this is only for manual `db push`/`migrate`/Prisma Studio
      operations, run from a developer machine, never invoked
      automatically by the Vercel build (see below). Transaction-mode
      poolers do not support the prepared-statement / schema-introspection
      behavior `db push`/`migrate` need, which is exactly why `DIRECT_URL`
      stays separate from `DATABASE_URL` in `prisma/schema.prisma`.

  Example shape only:
  ```
  DIRECT_URL="postgresql://<user>:<password>@<host>.pooler.supabase.com:5432/postgres"
  ```

- [ ] **This is a Vercel dashboard / environment-variable change only —
      no application code changes are needed.** `prisma/schema.prisma`
      already reads `url = env("DATABASE_URL")` and
      `directUrl = env("DIRECT_URL")`; only the connection-string
      *values* in Vercel's Environment Variables settings need to change.
      Update `DATABASE_URL` there to the transaction-pooler shape above,
      leave `DIRECT_URL` as-is, then trigger a redeploy.

- [ ] **Watch the next build after this change.** The Phase 29 concern
      below (build-time query burst against the transaction pooler) was
      observed locally, not yet confirmed against Vercel's own build
      machine with this exact setup. If a future Vercel build fails with
      pooler-saturation errors during "Collecting page data", that is a
      build-time-only symptom and does not mean the runtime fix above was
      wrong — it means the build step specifically may need its own
      handling (e.g. Vercel's build environment is a separate concern from
      the deployed function runtime). Do not revert `DATABASE_URL` back to
      the session pooler to fix a build failure; that reintroduces the
      runtime `EMAXCONNSESSION` error this change fixes. Report back
      instead so the build-time case can be investigated separately.

<details>
<summary>Original Phase 29 rationale for the session pooler (superseded above, kept for history)</summary>

Next.js's build-time "Collecting page data" step executes every dynamic
admin page's Prisma query at least once to classify it, and does so in a
concurrent burst across many routes. In Phase 29 that burst reliably
saturated the transaction pooler's connection slots and failed the build
twice in a row; the identical build against the session pooler passed
cleanly both times. That reasoning was sound for the build step, but it
was then also applied to the runtime `DATABASE_URL`, which is what caused
the Phase 31 `EMAXCONNSESSION` incident above — the build-time and
runtime connection strings don't have to be the same value, only
`DIRECT_URL` needs to stay stable across both.

</details>
- [ ] **Do not run `npx prisma db push` or `npm run db:seed` as part of
      the Vercel build.** Nothing in the `build` script does this, and
      nothing should be added to make it do this — the schema and seed
      data continue to be managed manually against the database directly,
      exactly as established in Phase 29.

### D) Google OAuth production redirect

- [ ] Set `GOOGLE_REDIRECT_URI` in Vercel's environment variables to the
      exact production callback URL:
      ```
      https://<your-vercel-domain>/auth/google/callback
      ```
- [ ] Add that same URL to the Google Cloud Console OAuth client's
      "Authorized redirect URIs" list
      (https://console.cloud.google.com/apis/credentials)
- [ ] No code or route changes are needed for this — `src/lib/auth/google.ts`
      already reads `GOOGLE_REDIRECT_URI` from the environment and uses it
      both to build the consent-screen URL and in the token exchange; it
      just needs the production value set in both places above. If left
      unset, "تسجيل الدخول بواسطة Google" safely no-ops (existing fallback
      behavior, unchanged) instead of erroring.

### E) Known limitation: product media uploads

Product image/video uploads (Phase 28) are saved via `fs.writeFile` to
`public/uploads/products/` on the local filesystem
(`src/lib/uploads.ts`). **Vercel's serverless functions run on a read-only
filesystem outside of `/tmp`** — attempting a product media upload on a
deployed Vercel instance will very likely fail outright (not just "not
durable," an actual runtime error), not silently degrade.

This is a known, accepted limitation of this phase, not something Phase 30
fixes. A future phase (Phase 31) should move product media uploads to
object storage — Supabase Storage, Vercel Blob, S3, or Cloudinary are all
viable — before uploads are relied on in a deployed environment. Until
then: uploads keep working locally in dev exactly as before; just don't
expect them to work once this app is actually deployed to Vercel.

**Update — actual production deployment is a VPS, not Vercel.** The app is
live behind Nginx + PM2 on a VPS, so the read-only-filesystem limitation
above does not apply there. However, Next.js's `next start` only discovers
files present in `public/` at process boot, so a file written to
`public/uploads/` while the server is already running previously 404'd
until the next PM2 restart. This is now fixed at the Nginx layer: `/uploads/`
is served directly via an `alias` location block in
`/etc/nginx/sites-available/ovimobile.net` (added outside this repo, on the
server), bypassing Next.js entirely for that path — uploads are available
immediately, no PM2 restart required.

Production notes:
- Uploads live at `/var/www/ovi-mobile/public/uploads/` on the VPS —
  Nginx serves them directly from the public `/uploads/` URL prefix.
- **Never run `git clean -fdx` in production** — `public/uploads/` is
  gitignored and untracked, so a clean wipes every uploaded file with no
  git history to recover from.
- Back up this directory separately from the database (see the backup
  recommendation the object-storage migration above should eventually
  replace).

### F) First deployment checks (once actually deployed — not done yet)

- [ ] Admin login
- [ ] Admin dashboard loads with live data
- [ ] `/admin/products` loads
- [ ] `/admin/inventory` loads
- [ ] `/products` (public storefront) loads
- [ ] `/products/[sku]` (product detail) loads
- [ ] Cart / checkout completes an order
- [ ] `/admin/orders/new` (manual order) works
- [ ] `/rep` (rep dashboard) loads
- [ ] `/rep/requests` (rep stock requests) loads

## Environment variables checklist

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | Yes | PostgreSQL connection string. **On Vercel: Supabase transaction pooler, port 6543, `?pgbouncer=true&connection_limit=1`** (see "Vercel deployment checklist" → C above — this fixed a Phase 31 `EMAXCONNSESSION` runtime error). Locally, the session pooler (port 5432) remains fine for `npm run dev`/`npm run build` on a single developer machine. Set directly in Vercel's dashboard for deployed environments — never committed. |
| `DIRECT_URL` | Yes | Non-pooled/session PostgreSQL connection (port 5432) Prisma uses for `db push`/`migrate`/Studio, run manually only — never invoked by the Vercel build. Same value shape locally and on Vercel. Never committed. |
| `NODE_ENV` | No — automatic | Set by the Next.js/Vercel runtime itself (`production` on Vercel builds/deploys). Do not set it manually. Controls: `secure` flag on session cookies (`src/lib/auth/session.ts`), and Prisma query log verbosity (`src/lib/prisma.ts`). |
| `GOOGLE_CLIENT_ID` | No — optional | Enables the "تسجيل الدخول بواسطة Google" button on `/login`. If unset, that flow safely redirects to a login error instead of working — the rest of the app is unaffected. |
| `GOOGLE_CLIENT_SECRET` | No — optional | Paired with `GOOGLE_CLIENT_ID`. Never expose client-side. |
| `GOOGLE_REDIRECT_URI` | No — optional | Must exactly match an "Authorized redirect URI" configured on the Google Cloud Console OAuth client. Set to `https://<your-vercel-domain>/auth/google/callback` in Vercel's production environment — not `localhost`. See "Vercel deployment checklist" → D above. |

No other environment variables are read anywhere in the codebase today
(confirmed by inspection — only `DATABASE_URL`, `DIRECT_URL`, `NODE_ENV`,
and the three optional `GOOGLE_*` variables above are referenced). There is
no session-signing secret to configure — sessions are DB-backed opaque rows,
not JWTs. Do not add speculative variables ahead of an actual feature that
needs them.

## Migration history checklist (for the future production hardening)

This is intentionally not being done now — listed here so it isn't
forgotten or done carelessly later. The database itself is already
PostgreSQL (Phase 29); what's still missing is a real migration history in
place of `db push`.

- [ ] In a dedicated reviewed change, run
      `npx prisma migrate dev --name init` locally against the PostgreSQL
      database to generate and apply the first migration
- [ ] Commit the generated `prisma/migrations/` directory
- [ ] Verify the app still runs correctly locally against PostgreSQL before
      deploying
- [ ] In production, apply migrations with `npx prisma migrate deploy` —
      never `db push` against a production database
- [ ] Decide separately whether to promote string-based statuses to native
      Postgres `enum` columns — optional, not required for correctness

## Prisma generate/build steps

Already wired for CI/Vercel:

- `package.json` → `"postinstall": "prisma generate"` runs automatically
  after `npm install`, before the build command.
- `package.json` → `"build": "prisma generate && next build"` (Phase 30)
  runs `prisma generate` again, unconditionally, right before `next build`
  — belt-and-suspenders alongside `postinstall`, closing an edge case where
  a cached `npm install` between deployments could skip regenerating the
  Prisma Client after a schema change. `prisma generate` needs no live
  database connection (confirmed in Phase 29), so this costs nothing.
- `npm run build` performs its own type-checking pass as part of the
  `next build` step.

Locally, if you ever see a stale-cache build error (e.g. an unrelated
`_document` module-not-found error during "Collecting page data"), it's a
local `.next` cache artifact, not a real code issue — a fresh checkout or a
CI/Vercel build never accumulates that cache in the first place. To verify:

```bash
rm -rf .next && npm run build          # macOS/Linux
Remove-Item -Recurse -Force .next; npm run build   # Windows PowerShell
```

No script has been added to delete `.next` automatically — this is a manual
verification step only, run when you actually suspect a stale cache.

## Production seed warning

**`npm run db:seed` must never be run against the production database.**

- It creates fixed, publicly-documented accounts (`admin@ovimobile.ps`,
  `Admin12345!`, etc. — see README) with known passwords. These exist
  purely so a fresh local checkout has something to log in with.
- It is idempotent (`upsert`/delete-then-recreate) by design for local
  development convenience — running it repeatedly against a real database
  would repeatedly reset real admin credentials to the seeded password.
- Production should have its first real admin account created through a
  separate, deliberate process (e.g. a one-time manual `INSERT`/Prisma
  Studio session against the production database, or a dedicated
  bootstrap script written later) — not this seed script. That bootstrap
  process is explicitly out of scope for this phase.

## Post-deploy smoke test checklist

Once a real deployment exists, verify before considering it live:

- [ ] `/` loads and renders the homepage
- [ ] `/products` loads and lists products
- [ ] `/login` loads and a login attempt succeeds
- [ ] `/admin` loads after logging in as an admin account
- [ ] `/cart` loads (empty-cart state is fine for a fresh database)
- [ ] `/checkout` loads for a logged-in cart-eligible user
- [ ] `/rep` loads after logging in as a sales representative
- [ ] `/merchant` loads after logging in as an approved merchant
- [ ] Session cookies are `Secure` (check via browser devtools → Application
      → Cookies) — confirms `NODE_ENV === "production"` is correctly set by
      the host
- [ ] No `.env`, `dev.db`, or other local-only file is present in the
      deployed source (check the Vercel deployment's source view, or `git
      ls-files` against the deployed commit)

## Rollback notes

- Vercel keeps previous deployments — rolling back is redeploying (or
  promoting) a prior successful deployment from the Vercel dashboard, no
  git action required.
- If a bad deploy also shipped a database migration, redeploying old code
  does **not** revert the database. Schema rollback must be handled
  separately (a new forward migration that undoes the change is safer than
  attempting to reverse-apply a migration).
- Because there is no migration history yet (see above), there is currently
  nothing to roll back at the database level — this section becomes
  actionable once the migration history checklist has been completed at
  least once.

## Security light review

Checked as part of this phase:

- [x] `.env` is not committed — gitignored (`.gitignore`), confirmed via
      `git log --all --full-history -- .env` returning no history
- [x] `prisma/dev.db` is not committed — gitignored, confirmed via `git log
      --all --full-history -- prisma/dev.db` returning no history
- [x] `.next/` is not committed — gitignored
- [x] `node_modules/` is not committed — gitignored
- [x] `.claude/` is not committed — gitignored (local tooling only)
- [x] `passwordHash` is never sent to the client — `getSession()` in
      `src/lib/auth/session.ts` explicitly returns only `id`, `role`,
      `name`, `email`, `merchantStatus`; the Prisma `select`/mapping never
      includes `passwordHash`
- [x] Sessions use `httpOnly` cookies — set in `src/lib/auth/session.ts`,
      never readable from client-side JavaScript
- [x] Cookies are `secure` in production — `secure: process.env.NODE_ENV
      === "production"` in `src/lib/auth/session.ts`, verified unchanged
      during this phase
