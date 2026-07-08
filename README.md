# Ovi Mobile

Premium mobile accessories e-commerce and wholesale management platform for Palestine. Single Next.js App Router application with TypeScript, Tailwind CSS, and Prisma.

## Status

Phase 2 — authentication and role-based access control added. No product CRUD,
checkout, inventory movements, or finance yet.

## Requirements

- Node.js 20.11+

## Setup

```bash
npm install
cp .env.example .env
npm run db:push
npm run db:seed
npm run dev
```

The app runs at `http://localhost:3000`.

## Structure

- `src/app` — routes (public site, `/admin` dashboard, `/login`, `/register`,
  `/register/merchant`, `/dashboard`, `/merchant`, `/merchant/pending`, `/rep`)
- `src/components/ui` — reusable primitives (Button, Card, Badge, Input)
- `src/components/layout` — Header, Footer, AdminSidebar, AdminTopbar
- `src/components/auth` — LogoutButton
- `src/lib` — `prisma.ts` (client singleton), `constants.ts`, `utils.ts`
- `src/lib/auth` — password hashing, DB-backed sessions, route guards
- `src/lib/validation` — Zod schemas for auth forms
- `src/middleware.ts` — coarse cookie-presence gate for protected routes
- `src/types` — shared TypeScript types
- `prisma/schema.prisma` — data model (SQLite now, PostgreSQL-ready later)
- `prisma/seed.ts` — seed script (admin + one account per role)

## Authentication

- Sessions are DB-backed and opaque: the cookie holds only a session id,
  looked up against the `Session` table on every request that needs it. No
  JWT, no signing secret — logout is a row delete.
- Passwords are hashed with Node's built-in `crypto.scrypt` (see
  `src/lib/auth/password.ts`) — no native dependency to compile.
- `src/middleware.ts` only checks whether a session cookie is present on
  `/admin`, `/merchant`, `/rep`, and `/dashboard`; the actual role/approval
  check happens server-side in each area's layout/page via
  `src/lib/auth/guards.ts`.

## Development Accounts

Seeded by `npm run db:seed`. Local development only — never use these in production.

| Role | Email | Password | Lands on |
| --- | --- | --- | --- |
| Admin | admin@ovimobile.ps | Admin12345! | `/admin` |
| Wholesale merchant (approved) | merchant.approved@ovimobile.ps | Merchant12345! | `/merchant` |
| Wholesale merchant (pending) | merchant.pending@ovimobile.ps | Merchant12345! | `/merchant/pending` |
| Sales representative | rep@ovimobile.ps | Rep12345! | `/rep` |
| Retail customer | customer@ovimobile.ps | Customer12345! | `/dashboard` |

## Notes

- Money is stored as `Int` in the smallest currency unit (agorot/cents) — never `Float`/`Decimal` — since SQLite has no native decimal type and this keeps the schema identical across SQLite and PostgreSQL.
- Default document direction is RTL/Arabic (`lang="ar" dir="rtl"`), set in `src/app/layout.tsx`.
