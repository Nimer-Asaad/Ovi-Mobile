# Ovi Mobile

Premium mobile accessories e-commerce and wholesale management platform for Palestine. Single Next.js App Router application with TypeScript, Tailwind CSS, and Prisma.

## Status

Phase 1 — project foundation only. No authentication, CRUD, or checkout yet.

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

- `src/app` — routes (public site + `/admin` dashboard)
- `src/components/ui` — reusable primitives (Button, Card, Badge)
- `src/components/layout` — Header, Footer, AdminSidebar, AdminTopbar
- `src/lib` — `prisma.ts` (client singleton), `constants.ts`, `utils.ts`
- `src/types` — shared TypeScript types
- `prisma/schema.prisma` — data model draft (SQLite now, PostgreSQL-ready later)
- `prisma/seed.ts` — seed script skeleton

## Notes

- Money is stored as `Int` in the smallest currency unit (agorot/cents) — never `Float`/`Decimal` — since SQLite has no native decimal type and this keeps the schema identical across SQLite and PostgreSQL.
- Default document direction is RTL/Arabic (`lang="ar" dir="rtl"`), set in `src/app/layout.tsx`.
