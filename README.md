# Ovi Mobile

Premium mobile accessories e-commerce and wholesale management platform for
Palestine. Single Next.js App Router application with TypeScript, Tailwind
CSS, and Prisma — covering the public storefront, retail cart/checkout,
wholesale merchant pricing and approval, sales-representative stock and
direct selling, and an admin back office for catalog, inventory, and order
management.

Repository: https://github.com/Nimer-Asaad/Ovi-Mobile

## Status

Phase 15 — performance polish, loading feedback, motion, and navy
navigation. Phases 1–14 (auth, catalog, product images, cart/checkout,
admin order management, inventory management, sales rep stock and direct
selling, merchant management, UI/UX polish, deployment prep, light theme
redesign, customer dashboard, Google login) are complete. No payment
gateway, invoices, finance/reporting, or delivery integration yet — the app
is not live in production.

## Tech Stack

- **Framework:** Next.js 15 (App Router, Server Components, Server Actions)
- **Language:** TypeScript (strict mode)
- **Database ORM:** Prisma — SQLite locally, PostgreSQL-ready for production (see below)
- **Styling:** Tailwind CSS, RTL/Arabic-first design
- **Validation:** Zod
- **Auth:** DB-backed opaque sessions (no JWT), `crypto.scrypt` password hashing

## Requirements

- Node.js 20.11+

## Local Setup

```bash
npm install
cp .env.example .env
npx prisma generate
npx prisma db push
npm run db:seed
npm run dev
```

The app runs at `http://localhost:3000`.

`npm run dev` can feel slower than a real deployment — it compiles each
route on demand and re-runs Fast Refresh on every save, which is normal
dev-mode overhead, not a sign of a slow app. To check real, production-like
speed instead:

```bash
npm run build
npm start
```

### Command reference

| Command | Purpose |
| --- | --- |
| `npm install` | Install dependencies (also runs `prisma generate` via `postinstall`) |
| `npx prisma generate` | Regenerate the Prisma Client from `schema.prisma` |
| `npx prisma db push` | Sync the database schema (SQLite file locally) without a migration history |
| `npm run db:seed` | Seed development accounts + sample catalog/stock — **local only, never run against production** |
| `npm run dev` | Start the dev server |
| `npm run build` | Production build (`next build`) |
| `npm run start` | Run a built app (`next start`) — requires `npm run build` first |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | `eslint .` |
| `npm run db:studio` | Open Prisma Studio against the local database |

## Structure

- `src/app` — routes: public site, `/products`, `/cart`, `/checkout`,
  `/orders`, `/admin` (catalog, inventory, orders, merchants, sales reps),
  `/login`, `/register`, `/register/merchant`, `/dashboard`, `/merchant`,
  `/merchant/pending`, `/rep`
- `src/components/ui` — reusable primitives (Button, Card, Badge, Input,
  Select, Textarea, PageHeader, StatCard, EmptyState)
- `src/components/layout` — Header, Footer, AdminSidebar, AdminTopbar
- `src/components/auth` — LogoutButton
- `src/components/admin` — AdminTable, AdminStatusBadge, ActiveToggleForm
- `src/components/catalog` — ProductCard, ProductGallery
- `src/components/cart` — AddToCartButton
- `src/lib` — `prisma.ts` (client singleton), `constants.ts`, `utils.ts`,
  `cart.ts`, `inventory.ts`, `reps.ts`, `catalog-queries.ts`, `order-labels.ts`
- `src/lib/auth` — password hashing, DB-backed sessions, route guards
- `src/lib/validation` — Zod schemas for auth, catalog, cart, orders,
  inventory, reps, and merchant forms
- `src/middleware.ts` — coarse cookie-presence gate for protected routes
- `src/types` — shared TypeScript types
- `prisma/schema.prisma` — data model (SQLite now, PostgreSQL-ready later —
  see "Database" below)
- `prisma/seed.ts` — seed script (dev accounts + sample catalog + demo stock)

## Authentication

- Sessions are DB-backed and opaque: the cookie holds only a session id,
  looked up against the `Session` table on every request that needs it. No
  JWT, no signing secret — logout is a row delete.
- Session cookies are `httpOnly`, `sameSite: "lax"`, and `secure` only when
  `NODE_ENV === "production"` (see `src/lib/auth/session.ts`).
- Passwords are hashed with Node's built-in `crypto.scrypt` (see
  `src/lib/auth/password.ts`) — no native dependency to compile.
- `src/middleware.ts` only checks whether a session cookie is present on
  protected paths; the actual role/approval check happens server-side in
  each area's layout/page via `src/lib/auth/guards.ts`.
- **Google login** (`/auth/google` → `/auth/google/callback`) is an optional
  second way into the same session system — no NextAuth, no second session
  store. It requires `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and
  `GOOGLE_REDIRECT_URI` (see `.env.example`); the redirect URI must be
  registered in the Google Cloud Console OAuth client's "Authorized redirect
  URIs". If unset, the "تسجيل الدخول بواسطة Google" button on `/login` still
  renders but safely redirects back with an error instead of crashing.
  Existing accounts log in unchanged (role never modified); a Google email
  with no matching account always creates a plain `RETAIL_CUSTOMER` — never
  an admin, merchant, or rep.

## Development Accounts

Seeded by `npm run db:seed`. Local development only — never use these in production.

| Role | Email | Password | Lands on |
| --- | --- | --- | --- |
| Admin | admin@ovimobile.ps | Admin12345! | `/admin` |
| Wholesale merchant (approved) | merchant.approved@ovimobile.ps | Merchant12345! | `/merchant` |
| Wholesale merchant (pending) | merchant.pending@ovimobile.ps | Merchant12345! | `/merchant/pending` |
| Sales representative | rep@ovimobile.ps | Rep12345! | `/rep` |
| Retail customer | customer@ovimobile.ps | Customer12345! | `/dashboard` |

## Database

**Local development uses SQLite** (`prisma/dev.db`, gitignored) — zero setup,
nothing to provision, `npx prisma db push` syncs the schema directly.

**Production should use PostgreSQL, not SQLite.** The schema was written
with this in mind from Phase 1:

- Every "enum-like" field (order status, role, stock movement type, etc.) is
  a `String` constrained by `src/lib/constants.ts`, not a native Prisma
  `enum` — SQLite doesn't support native enums, PostgreSQL does. This keeps
  the schema identical across both, and these can optionally be promoted to
  real `enum` columns after a PostgreSQL cutover without changing
  application code.
- All money fields are `Int` (smallest currency unit, e.g. agorot), never
  `Float`/`Decimal` — SQLite has no native decimal type, so this keeps
  behavior identical on both databases and avoids floating-point rounding
  entirely.
- All ids are `cuid()` strings — no database-specific autoincrement
  behavior to reconcile.

**The datasource provider has not been switched yet** — `prisma/schema.prisma`
still declares `provider = "sqlite"`. See [DEPLOYMENT.md](DEPLOYMENT.md) for
the full PostgreSQL migration checklist before that switch happens.

**This project currently uses `prisma db push`, not migrations.** That's
fine for local development, but production must use a real migration
history (`npx prisma migrate dev` to generate it, `npx prisma migrate
deploy` to apply it) rather than continuing to push schema changes directly
— see DEPLOYMENT.md.

## Deployment

Not yet deployed. See [DEPLOYMENT.md](DEPLOYMENT.md) for the full checklist
before any real deployment — environment variables, database migration
plan, build steps, and post-deploy verification. The suggested path is
Vercel (native Next.js support) with a managed PostgreSQL provider (Neon,
Supabase, or Railway) once the app is ready to go live.

## Notes

- Default document direction is RTL/Arabic (`lang="ar" dir="rtl"`), set in
  `src/app/layout.tsx`.
- A clean production build can be verified locally with:
  `rm -rf .next && npm run build` (macOS/Linux) or
  `Remove-Item -Recurse -Force .next; npm run build` (Windows PowerShell).
