# Ovi Mobile Architecture

## Monorepo

Ovi Mobile uses a pnpm workspace monorepo with Turborepo task orchestration.

The repository keeps deployable applications in `apps` and shared internal packages in `packages`.

## Applications

### `apps/web`

The customer and management frontend is a Next.js App Router application with TypeScript, Tailwind CSS, and RTL-first defaults.

The frontend must never connect directly to PostgreSQL. It communicates with the backend through HTTP APIs and shared contracts.

### `apps/api`

The backend is a NestJS REST API. It owns business logic, validation, transactions, audit-ready workflows, and future integrations with Prisma, Supabase Auth, and storage services.

The initial foundation exposes only a health endpoint and Swagger documentation. Business modules are intentionally not created yet.

## Shared Packages

### `packages/config`

Shared TypeScript, ESLint, and formatting configuration used by workspace apps and packages.

### `packages/contracts`

Shared DTO-friendly types and API contract placeholders. This package should contain transport shapes only, not persistence models or business services.

### `packages/api-client`

A reusable typed HTTP client base for browser or server usage. Feature-specific clients will be added only when their modules are implemented.

### `packages/ui`

Minimal shared UI foundations such as design tokens. Product-specific components should stay in the app until reuse is clear.

## Future Boundaries

Future business modules should be added in the NestJS API as isolated modules with DTO validation, service boundaries, and transaction-safe data access.

Planned domains include authentication, categories, brands, suppliers, products, warehouses, inventory, merchants, representatives, orders, ledgers, settlements, reports, notifications, and audit logs.

Financial values must use decimal or numeric database types. Stock movements and ledger entries must be immutable and traceable.

Images must be stored in object storage through a `StorageService` abstraction, not in PostgreSQL.
