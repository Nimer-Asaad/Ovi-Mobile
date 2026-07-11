# Deployment Guide

This document is a checklist for the future, real deployment of Ovi Mobile.
**Nothing in this document has been executed yet** — the app has not been
deployed, and the production database has not been switched. This is
preparation only.

## Database: SQLite locally, PostgreSQL in production

SQLite is fine for local development — it's a single file, needs no
provisioning, and `npx prisma db push` syncs the schema instantly.

**SQLite is not recommended as the production database on Vercel** (or any
serverless host). Serverless functions get a fresh, ephemeral filesystem on
every invocation and may run across multiple instances concurrently — a
SQLite file written on one invocation is not reliably visible to the next,
and there is no durable disk to persist it on. This is not a performance
tuning issue, it is a correctness issue: writes can silently be lost.

**Recommendation:** before any real production deployment, provision a
managed PostgreSQL database — [Neon](https://neon.tech),
[Supabase](https://supabase.com), [Railway](https://railway.app), or
similar all have a free/starter tier and work well with Prisma + Vercel.
This project has **not** set one up yet — see "PostgreSQL readiness" below
for what already supports this and what still needs to happen.

## PostgreSQL readiness (design-time, not yet switched)

The schema (`prisma/schema.prisma`) was written to make this switch
low-risk when it happens:

- **Int money fields**, not `Decimal`/`Float` — SQLite has no native
  decimal type, so pricing/cost fields are already stored as integer cents.
  Identical behavior on both databases, no floating-point rounding.
- **String-based statuses**, not native Prisma `enum` — SQLite doesn't
  support `enum` columns, PostgreSQL does. Every status/role/type field is a
  `String` constrained by `src/lib/constants.ts` instead, so the schema is
  unchanged across both databases. These can optionally be promoted to real
  `enum` columns after a PostgreSQL cutover, as a separate follow-up, without
  touching application code.
- **`cuid()` string ids** everywhere — no autoincrement sequence behavior
  to reconcile between databases.

**What has NOT happened yet, and must not happen without separate
approval:**
- The datasource provider is still `provider = "sqlite"` in
  `prisma/schema.prisma`. Switching it to `"postgresql"` is a deliberate,
  reviewed step, not a side effect of deployment prep.
- **No migration history exists.** This project has only ever used
  `npx prisma db push`, which has no concept of a migration history — it
  just reconciles the live schema. Production must not do this. Before the
  first production deploy against PostgreSQL:
  1. Switch the provider in a dedicated, reviewed change.
  2. Run `npx prisma migrate dev --name init` locally against a real
     PostgreSQL instance to generate the first migration file.
  3. Commit `prisma/migrations/`.
  4. In production, run `npx prisma migrate deploy` (never `db push`,
     never `migrate dev`) to apply migrations.
- No Neon/Supabase/Railway project has been created for this app.

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
- [ ] Do not point production at the SQLite file — see the database section
      above

## Environment variables checklist

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | Yes | Local: `file:./dev.db`. Production: a PostgreSQL connection string from your provider, set directly in Vercel's dashboard — never committed. |
| `NODE_ENV` | No — automatic | Set by the Next.js/Vercel runtime itself (`production` on Vercel builds/deploys). Do not set it manually. Controls: `secure` flag on session cookies (`src/lib/auth/session.ts`), and Prisma query log verbosity (`src/lib/prisma.ts`). |
| `GOOGLE_CLIENT_ID` | No — optional | Enables the "تسجيل الدخول بواسطة Google" button on `/login`. If unset, that flow safely redirects to a login error instead of working — the rest of the app is unaffected. |
| `GOOGLE_CLIENT_SECRET` | No — optional | Paired with `GOOGLE_CLIENT_ID`. Never expose client-side. |
| `GOOGLE_REDIRECT_URI` | No — optional | Must exactly match an "Authorized redirect URI" configured on the Google Cloud Console OAuth client, and must use the production domain in production (e.g. `https://ovimobile.example/auth/google/callback`), not `localhost`. |

No other environment variables are read anywhere in the codebase today
(confirmed by inspection — only `DATABASE_URL`, `NODE_ENV`, and the three
optional `GOOGLE_*` variables above are referenced). Do not add speculative
variables ahead of an actual feature
that needs them.

## Database migration checklist (for the future PostgreSQL cutover)

This is intentionally not being done now — listed here so it isn't
forgotten or done carelessly later.

- [ ] Provision a PostgreSQL database (Neon/Supabase/Railway/other)
- [ ] Get its connection string, set as `DATABASE_URL` in Vercel (production
      environment) — do not put it in any committed file
- [ ] In a dedicated reviewed change: switch
      `datasource db { provider = "postgresql" }` in `prisma/schema.prisma`
- [ ] Run `npx prisma migrate dev --name init` locally against the new
      PostgreSQL database to generate and apply the first migration
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
  actionable once the PostgreSQL migration checklist has been completed at
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
