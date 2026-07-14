# Deployment Guide

This document is a checklist for the future, real deployment of Ovi Mobile.
**The app has not been deployed to Vercel yet.** As of Phase 29, the
database has moved from local SQLite to online PostgreSQL (Supabase
preferred) — that part of this checklist is done. Vercel deployment itself,
a real migration history, and cloud media storage are still separate,
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

## Vercel deployment checklist

Not yet done — checklist for when it happens:

- [ ] Push the target branch to GitHub (already done: `main` is on
      https://github.com/Nimer-Asaad/Ovi-Mobile)
- [ ] Import the repository into Vercel
- [ ] Set the **Environment Variables** (see below) in the Vercel project
      settings before the first deploy
- [ ] Confirm the Vercel build command is `next build` (default — no
      `vercel.json` override needed for this project)
- [ ] Confirm `npm install` runs `prisma generate` via the `postinstall`
      script (already added — see `package.json`) so the Prisma Client is
      generated before `next build` runs
- [ ] Trigger the first deploy and watch the build log for Prisma or
      TypeScript errors
- [ ] Set `DATABASE_URL`/`DIRECT_URL` in Vercel to the **production**
      Supabase/Postgres project's connection strings — not the same
      database used for local development (see "Database" above)
- [ ] Product media (`public/uploads/products/`) is local-disk storage —
      not production-safe on Vercel's ephemeral filesystem. Do not treat
      product image/video uploads as durable until cloud storage (Supabase
      Storage, S3, Cloudinary, or Vercel Blob) replaces it in a later phase.

## Environment variables checklist

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | Yes | PostgreSQL connection string (Supabase Session pooler for local dev; see "Database" above). Set directly in Vercel's dashboard for deployed environments — never committed. |
| `DIRECT_URL` | Yes | Non-pooled PostgreSQL connection Prisma uses for `db push`/`migrate`. Same rules as `DATABASE_URL` — never committed. |
| `NODE_ENV` | No — automatic | Set by the Next.js/Vercel runtime itself (`production` on Vercel builds/deploys). Do not set it manually. Controls: `secure` flag on session cookies (`src/lib/auth/session.ts`), and Prisma query log verbosity (`src/lib/prisma.ts`). |
| `GOOGLE_CLIENT_ID` | No — optional | Enables the "تسجيل الدخول بواسطة Google" button on `/login`. If unset, that flow safely redirects to a login error instead of working — the rest of the app is unaffected. |
| `GOOGLE_CLIENT_SECRET` | No — optional | Paired with `GOOGLE_CLIENT_ID`. Never expose client-side. |
| `GOOGLE_REDIRECT_URI` | No — optional | Must exactly match an "Authorized redirect URI" configured on the Google Cloud Console OAuth client, and must use the production domain in production (e.g. `https://ovimobile.example/auth/google/callback`), not `localhost`. Changing this for a production domain is a separate, later step — not part of Phase 29. |

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
  after `npm install`, before `next build` — this was the one functional
  gap found during deployment prep and has been fixed.
- `npm run build` runs `next build`, which performs its own type-checking
  pass as part of the build.

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
