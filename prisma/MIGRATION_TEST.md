# Testing the `add_device_color_inventory_tracking` migration on an isolated database

This covers migration `20260814120000_add_device_color_inventory_tracking`
(per-product inventory tracking modes — TOTAL_STOCK / DEVICE_MODEL_COLOR).
Run this **before** deploying the migration anywhere real. It never touches
the project's configured `DATABASE_URL`/`DIRECT_URL`, never connects to
production, and never runs `prisma migrate reset`.

Every command below uses a connection string held in an environment
variable you set yourself — nothing here contains a real password or
secret, and none of the scripts print the full connection string (only a
masked `host:port/dbname` form).

## Safety guardrails (enforced automatically, in `prisma/verify-guardrails.ts`)

Every script below refuses to run unless **all** of the following hold:

| Check | Rejected if |
|---|---|
| Independent env var | `INVENTORY_TRACKING_VERIFY_DATABASE_URL` is unset — these scripts never fall back to `DATABASE_URL`/`DIRECT_URL` |
| Database name | The URL's database name doesn't contain `verify` |
| Host | The host isn't `localhost`/`127.0.0.1`/`::1`, **and** you haven't also set `INVENTORY_TRACKING_VERIFY_ALLOWED_HOST` to that exact hostname (a deliberate double opt-in for a real test server — never for production) |
| Not the real database | The URL (or its host+port+dbname) matches a configured `DATABASE_URL`/`DIRECT_URL`, read from `process.env` or from a local `.env`/`.env.local` if present |
| Empty database (upgrade test only) | The target database already has a `_prisma_migrations` history table — `verify-migration-upgrade.ts` only ever builds up a database from a blank slate it creates itself |

If any check fails, the script throws immediately with a specific message
and never opens a connection.

## Prerequisites

- A disposable PostgreSQL server you control (local install, Docker, or a
  dedicated test server) — **never** the project's Supabase/production
  instance.
- Node ≥ 20.11 and this repo's dependencies installed (`npm install`).

## Scenario 1 — Fresh database (apply every migration from zero)

```bash
# 1. Create an empty, disposable database. Example with a local Postgres
#    server (adjust user/host/port to your setup):
createdb -h localhost -p 5432 ovi_verify_fresh

# 2. Point Prisma at it for this shell session only.
export DATABASE_URL="postgresql://<user>:<password>@localhost:5432/ovi_verify_fresh"
export DIRECT_URL="$DATABASE_URL"

# 3. Apply every migration in order, the official way.
npx prisma migrate deploy

# 4. Optional but recommended: run the feature suite against the fresh DB
#    to prove the end state is fully functional, not just "migrated".
export INVENTORY_TRACKING_VERIFY_DATABASE_URL="$DATABASE_URL"
npm run verify:inventory-tracking-modes
```

Expected result: `prisma migrate deploy` reports all migrations applied
with no errors, and every `PASS ...` line prints from the verify script
with a final `All inventory tracking mode verification checks passed`.

## Scenario 2 — Upgrade (simulate an existing installation, then migrate)

This is fully automated by `prisma/verify-migration-upgrade.ts` — it builds
the pre-upgrade schema itself (every migration older than the target one,
copied from this project's real `prisma/migrations` folder into a temp
directory it deletes afterward — the real folder is only ever read, never
written to), seeds realistic legacy data, snapshots it, applies the new
migration through the real `prisma/schema.prisma` ("the official way"),
snapshots again, and asserts nothing changed except the new defaults.

```bash
# 1. Create a second empty, disposable database (must be a DIFFERENT
#    database than any used in Scenario 1 — this script requires the target
#    to have zero prior migration history).
createdb -h localhost -p 5432 ovi_verify_upgrade

# 2. Provide ONLY the independent verify env var — do not export
#    DATABASE_URL/DIRECT_URL yourself for this scenario, the script sets
#    them internally after validating the URL.
export INVENTORY_TRACKING_VERIFY_DATABASE_URL="postgresql://<user>:<password>@localhost:5432/ovi_verify_upgrade"

# 3. Run it.
npm run verify:migration-upgrade
```

### What this proves, step by step

1. Builds a temp copy of `prisma/migrations` containing every migration
   **before** `20260814120000_add_device_color_inventory_tracking`, applies
   it with `prisma migrate deploy` — this is the pre-upgrade shape.
2. Seeds, via raw SQL (so it works whether or not the new columns exist
   yet): one plain product, one `PHONE_COMPATIBILITY` product with a
   `ProductVariant`, three `InventoryItem` rows (one plain, two
   variant-linked across two different `StockLocation`s), three
   `StockMovement` rows (one plain, two variant-linked), and an in-use
   `PhoneBrand`/`PhoneModel`/`Color`.
3. Snapshots row counts, total inventory quantity, and SHA-256 content
   checksums of `products`/`inventory_items`/`stock_movements`/`product_variants`.
4. Applies `20260814120000_add_device_color_inventory_tracking` through the
   real, unmodified `prisma/schema.prisma` — the same command/files a real
   deploy would use.
5. Snapshots again and asserts: identical row counts, identical quantity
   sum, identical checksums, every legacy product's new
   `inventoryTrackingMode` reads `TOTAL_STOCK`, the `PHONE_COMPATIBILITY`
   product's `variantMode` is untouched, and a real increment/decrement
   round-trip through `src/lib/inventory-transactions.ts` against its
   pre-existing `InventoryItem` row still works post-migration.
6. Delegates to `verify-inventory-tracking-modes.ts` (run as a subprocess
   against the same now-upgraded database) for the full `DEVICE_MODEL_COLOR`
   feature suite: model filtering by brand, one model in two colors,
   the same combination independently stocked across two `StockLocation`s,
   duplicate-combination rejection, the `variantId`/`deviceColorVariantId`
   XOR constraint, a `StockMovement` carrying `deviceColorVariantId`, and
   both directions of the guarded tracking-mode conversion.

### What you'll see

- One `PASS <check name>` line per assertion, in order.
- On any failure: `FAIL <check name>` followed by the thrown error, and the
  process exits with a non-zero code — nothing after that check runs.
- A `before-upgrade snapshot:` / `after-upgrade snapshot:` line showing the
  actual counts, for a human sanity check alongside the automated asserts.
- Ends with `All migration upgrade verification checks passed.` and a note
  that the legacy fixture rows are left in place on purpose (see Cleanup).

## Cleanup (manual — nothing here is executed automatically)

Neither script drops any database. When you're done inspecting the result:

```bash
dropdb -h localhost -p 5432 ovi_verify_fresh
dropdb -h localhost -p 5432 ovi_verify_upgrade
```

If you used Docker for the Postgres server itself, remove the container
separately (`docker rm -f <container>`) — that's outside what these
scripts touch at all.

## Notes

- Never commit a `.env` file containing these test credentials.
- These scripts are read-only with respect to the project's real
  `DATABASE_URL`/`DIRECT_URL` — they only ever read those values (to make
  sure the verify URL isn't accidentally the same one) and never write to
  or connect to whatever they point at.
- `verify:migration-upgrade` shells out to `npx prisma migrate deploy`
  twice and to `verify:inventory-tracking-modes` once — expect it to take
  noticeably longer than the other verify scripts.
